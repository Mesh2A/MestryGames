import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const TURN_MS = 30_000;

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function readPhotoFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).photo;
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^data:image\/(png|jpeg|webp);base64,/i.test(s) && s.length < 150000 ? s : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name;
  return firstNameFromEmail(email);
}

function safeState(raw: unknown) {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(s.a) ? s.a : [];
  const b = Array.isArray(s.b) ? s.b : [];
  const lastMasked = s.lastMasked && typeof s.lastMasked === "object" ? (s.lastMasked as Record<string, unknown>) : null;
  const endedReason = typeof s.endedReason === "string" ? s.endedReason : null;
  const forfeitedBy = typeof s.forfeitedBy === "string" ? s.forfeitedBy : null;
  const kind = s.kind === "custom" ? ("custom" as const) : ("normal" as const);
  const phase = kind === "custom" && s.phase === "setup" ? ("setup" as const) : ("play" as const);
  const secrets = s.secrets && typeof s.secrets === "object" ? (s.secrets as Record<string, unknown>) : {};
  const ready = s.ready && typeof s.ready === "object" ? (s.ready as Record<string, unknown>) : {};
  const secretA = typeof secrets.a === "string" ? secrets.a : "";
  const secretB = typeof secrets.b === "string" ? secrets.b : "";
  const hasSecretA = secretA.length > 0;
  const hasSecretB = secretB.length > 0;
  const readyA = ready.a === true;
  const readyB = ready.b === true;
  return { a, b, lastMasked, endedReason, forfeitedBy, kind, phase, secretA, secretB, hasSecretA, hasSecretB, readyA, readyB };
}

function maskDigits(len: number) {
  return Array.from({ length: Math.max(0, Math.floor(len)) })
    .map(() => "M")
    .join("");
}

function normalizeStateForDisabled(raw: unknown) {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(base.a) ? base.a : [];
  const b = Array.isArray(base.b) ? base.b : [];
  const lastMasked = base.lastMasked && typeof base.lastMasked === "object" ? base.lastMasked : null;
  return { ...base, a, b, lastMasked, endedReason: "disabled", forfeitedBy: null };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const matchId = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!matchId) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const onlineEnabled = await getOnlineEnabled();

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        {
          id: string;
          mode: string;
          fee: number;
          codeLen: number;
          aEmail: string;
          bEmail: string;
          answer: string;
          turnEmail: string;
          turnStartedAt: bigint;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","mode","fee","codeLen","aEmail","bEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email) return { ok: false as const, error: "forbidden" as const };

      if (!onlineEnabled && !m.endedAt) {
        const nextState = normalizeStateForDisabled(m.state);
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        const refund = async (who: string) => {
          const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(m.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(m.aEmail);
        await refund(m.bEmail);

        m.winnerEmail = null;
        m.endedAt = new Date();
        m.state = nextState;
      }

      const stateForTurn = safeState(m.state);
      const now = Date.now();
      const turnStartedAt = Number(m.turnStartedAt || 0);
      const expired = stateForTurn.phase !== "setup" && !m.endedAt && turnStartedAt > 0 && now - turnStartedAt >= TURN_MS;
      if (expired) {
        const nextTurn = m.turnEmail === m.aEmail ? m.bEmail : m.aEmail;
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        m.turnEmail = nextTurn;
        m.turnStartedAt = BigInt(now);
      }

      let state = stateForTurn;
      if (state.kind === "custom" && state.phase === "setup" && state.readyA && state.readyB && !m.endedAt) {
        const now2 = Date.now();
        const aStarts = (now2 & 1) === 1;
        const turnEmail2 = aStarts ? m.aEmail : m.bEmail;
        const nextState = { ...(m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {}), phase: "play" };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "turnEmail" = ${turnEmail2}, "turnStartedAt" = ${now2}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        m.turnEmail = turnEmail2;
        m.turnStartedAt = BigInt(now2);
        m.state = nextState;
        state = safeState(m.state);
      }

      const myRole = m.aEmail === email ? "a" : "b";
      const myHistory = (myRole === "a" ? state.a : state.b).filter((x) => x && typeof x === "object").slice(-120);

      const oppEmail = m.aEmail === email ? m.bEmail : m.aEmail;
      const oppProfile = await tx.gameProfile.findUnique({
        where: { email: oppEmail },
        select: { email: true, publicId: true, state: true, createdAt: true },
      });

      const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true, publicId: true } });
      const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
      const myCoins = readCoinsFromState(myState);
      const myLevel = getProfileLevel(myProfile?.state).level;

      const timeLeftMs = m.endedAt ? 0 : Math.max(0, TURN_MS - (Date.now() - Number(m.turnStartedAt || 0)));

      const lastMasked =
        state.lastMasked &&
        typeof state.lastMasked.by === "string" &&
        typeof state.lastMasked.at === "number" &&
        typeof state.lastMasked.len === "number"
          ? {
              by: state.lastMasked.by,
              at: state.lastMasked.at,
              value: maskDigits(state.lastMasked.len),
            }
          : null;

      let solution: string | null = null;
      const isEnded = !!m.endedAt || !!m.winnerEmail;
      const isDisabled = state.endedReason === "disabled";
      if (isEnded && !isDisabled) {
        if (state.kind === "custom") {
          if (m.winnerEmail === m.aEmail) solution = state.secretB || null;
          else if (m.winnerEmail === m.bEmail) solution = state.secretA || null;
        } else {
          const ans = typeof m.answer === "string" ? m.answer : "";
          solution = ans ? ans : null;
        }
      }

      return {
        ok: true as const,
        match: {
          id: m.id,
          mode: m.mode,
          fee: m.fee,
          codeLen: m.codeLen,
          kind: state.kind,
          phase: state.phase,
          myReady: myRole === "a" ? state.readyA : state.readyB,
          oppReady: myRole === "a" ? state.readyB : state.readyA,
          myHasSecret: myRole === "a" ? state.hasSecretA : state.hasSecretB,
          oppHasSecret: myRole === "a" ? state.hasSecretB : state.hasSecretA,
          myRole,
          myId: myProfile?.publicId || null,
          myCoins,
          myLevel,
          turn: m.endedAt ? "ended" : state.phase === "setup" ? "setup" : m.turnEmail === email ? "me" : "them",
          timeLeftMs: state.phase === "setup" ? 0 : timeLeftMs,
          winner: m.winnerEmail ? (m.winnerEmail === email ? "me" : "them") : null,
          endedAt: m.endedAt ? m.endedAt.toISOString() : null,
          endedReason: state.endedReason,
          forfeitedBy: state.forfeitedBy ? (state.forfeitedBy === email ? "me" : "them") : null,
          solution,
          opponent: oppProfile
            ? {
                id: oppProfile.publicId,
                firstName: firstNameFromDisplayNameOrEmail(readDisplayNameFromState(oppProfile.state), oppProfile.email),
                photo: readPhotoFromState(oppProfile.state),
                createdAt: oppProfile.createdAt.toISOString(),
                stats: getProfileStats(oppProfile.state),
                level: getProfileLevel(oppProfile.state).level,
              }
            : null,
          myHistory,
          lastMasked,
        },
      };
    });

    if (!out.ok) return NextResponse.json(out, { status: out.error === "forbidden" ? 403 : 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

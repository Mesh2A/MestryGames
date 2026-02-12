import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { logOnlineEvent } from "@/lib/onlineLog";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

function randomId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function nowMs() {
  return Date.now();
}

const STALE_START_MS = 180_000;
const STALE_MATCH_MS = 600_000;

function isStalePreStartState(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const phase = typeof s.phase === "string" ? s.phase : "";
  if (phase === "play") return false;
  return phase === "setup" || phase === "cards" || phase === "waiting";
}

function matchKind(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return s.kind === "group4" ? ("group4" as const) : s.kind === "custom" ? ("custom" as const) : s.kind === "props" ? ("props" as const) : ("normal" as const);
}

function normalizeMode(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "easy" || m === "medium" || m === "hard") return m;
  return "";
}

function normalizeKind(kind: string) {
  const k = String(kind || "").trim().toLowerCase();
  if (k === "props" || k === "properties") return "props";
  if (k === "custom" || k === "specified" || k === "limited") return "custom";
  return "normal";
}

function queueModeKey(baseMode: "easy" | "medium" | "hard", kind: "normal" | "custom" | "props", groupSize: number) {
  if (groupSize === 4 && kind === "props") return `${baseMode}_g4_props`;
  if (groupSize === 4) return `${baseMode}_g4`;
  if (kind === "custom") return `${baseMode}_custom`;
  if (kind === "props") return `${baseMode}_props`;
  return baseMode;
}

function parseQueueModeKey(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_g4_props")) return { mode: m.slice(0, -"_g4_props".length), kind: "props" as const, groupSize: 4 as const };
  if (m.endsWith("_g4")) return { mode: m.slice(0, -"_g4".length), kind: "normal" as const, groupSize: 4 as const };
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const, groupSize: 2 as const };
  if (m.endsWith("_props")) return { mode: m.slice(0, -"_props".length), kind: "props" as const, groupSize: 2 as const };
  return { mode: m, kind: "normal" as const, groupSize: 2 as const };
}

function configForMode(mode: "easy" | "medium" | "hard", kind: "normal" | "custom" | "props", groupSize: number) {
  const base = mode === "easy" ? { fee: 29, codeLen: 3 } : mode === "medium" ? { fee: 45, codeLen: 4 } : { fee: 89, codeLen: 5 };
  const k = kind === "custom" ? "custom" : kind === "props" ? "props" : "normal";
  const g = groupSize === 4 ? 4 : 2;
  let fee = base.fee;
  if (g !== 4) {
    if (k === "custom") fee += 6;
    else if (k === "props") fee += 12;
  }
  return { fee, codeLen: base.codeLen };
}

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

function generateAnswer(codeLen: number) {
  const digits: string[] = [];
  const used = new Set<number>();
  while (digits.length < codeLen) {
    const d = randomBytes(1)[0] % 10;
    if (used.has(d)) continue;
    used.add(d);
    digits.push(String(d));
  }
  return digits.join("");
}

function generatePropsDeck() {
  const pool = ["skip_turn", "double_or_nothing", "reverse_digits", "hide_colors"];
  const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(pool[randomBytes(1)[0] % pool.length]);
  return out;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const ban = await getActiveBan(email);
  if (ban) return NextResponse.json({ error: "banned", bannedUntilMs: ban.bannedUntilMs, reason: ban.reason }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const onlineEnabled = await getOnlineEnabled();
  if (!onlineEnabled) return NextResponse.json({ error: "online_disabled" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const conn = await requireActiveConnection(req, email);
  if (!conn.ok) return NextResponse.json({ error: conn.error }, { status: 409, headers: { "Cache-Control": "no-store" } });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const modeRaw = body && typeof body === "object" && "mode" in body ? (body as { mode?: unknown }).mode : "";
  const kindRaw = body && typeof body === "object" && "kind" in body ? (body as { kind?: unknown }).kind : "";
  const groupRaw = body && typeof body === "object" && "groupSize" in body ? (body as { groupSize?: unknown }).groupSize : 2;
  const mode = normalizeMode(typeof modeRaw === "string" ? modeRaw : "");
  if (!mode) return NextResponse.json({ error: "bad_mode" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const kind = normalizeKind(typeof kindRaw === "string" ? kindRaw : "") as "normal" | "custom" | "props";
  const groupSize = groupRaw === 4 || groupRaw === "4" ? 4 : 2;
  const effectiveKind = groupSize === 4 ? (kind === "props" ? ("props" as const) : ("normal" as const)) : kind;

  const { fee, codeLen } = configForMode(mode as "easy" | "medium" | "hard", effectiveKind, groupSize);
  const modeKey = queueModeKey(mode as "easy" | "medium" | "hard", effectiveKind, groupSize);

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const activeMatch = await tx.$queryRaw<
        { id: string; fee: number; aEmail: string; bEmail: string; cEmail: string | null; dEmail: string | null; state: unknown; createdAt: Date; updatedAt: Date }[]
      >`
        SELECT "id","fee","aEmail","bEmail","cEmail","dEmail","state","createdAt","updatedAt"
        FROM "OnlineMatch"
        WHERE ("aEmail" = ${email} OR "bEmail" = ${email} OR "cEmail" = ${email} OR "dEmail" = ${email}) AND "endedAt" IS NULL AND "winnerEmail" IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (activeMatch && activeMatch[0]) {
        const row = activeMatch[0];
        const lastMs = Math.max(row.updatedAt ? row.updatedAt.getTime() : 0, row.createdAt ? row.createdAt.getTime() : 0);
        const kind = matchKind(row.state);
        const stale =
          lastMs > 0 &&
          ((kind === "group4" && Date.now() - lastMs > STALE_MATCH_MS) || (Date.now() - lastMs > STALE_START_MS && isStalePreStartState(row.state)));
        if (!stale) return { status: "error" as const, error: "already_in_match" as const, matchId: row.id };
        const prev = row.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
        const nextState = { ...prev, endedReason: "stale", forfeitedBy: null, endedAt: Date.now() };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${row.id}
        `;
        const refund = async (who: string | null) => {
          if (!who) return;
          const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(row.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(row.aEmail);
        await refund(row.bEmail);
        await refund(row.cEmail);
        await refund(row.dEmail);
      }

      const activeRoom = await tx.$queryRaw<{ code: string }[]>`
        SELECT "code"
        FROM "OnlineRoom"
        WHERE ("hostEmail" = ${email} OR "guestEmail" = ${email}) AND "status" = 'waiting'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (activeRoom && activeRoom[0]) return { status: "error" as const, error: "already_in_room" as const, roomCode: activeRoom[0].code };

      const existing = await tx.$queryRaw<
        { id: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number }[]
      >`SELECT "id", "status", "matchId", "mode", "fee", "codeLen" FROM "OnlineQueue" WHERE "email" = ${email} AND "status" = 'waiting' ORDER BY "createdAt" DESC LIMIT 1`;
      if (existing && existing[0]) {
        const row = existing[0];
        const profileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const stateObj = profileRow?.state && typeof profileRow.state === "object" ? (profileRow.state as Record<string, unknown>) : {};
        const coins = readCoinsFromState(stateObj);
        const parsed = parseQueueModeKey(row.mode);
        const sameMode = parsed.mode === mode && parsed.kind === effectiveKind && parsed.groupSize === groupSize;
        if (!sameMode) {
          await tx.$executeRaw`UPDATE "OnlineQueue" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE "id" = ${row.id}`;
          const peak = readCoinsPeakFromState(stateObj);
          const feeBack = Math.max(0, Math.floor(row.fee));
          const nextCoins = coins + feeBack;
          const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
        } else {
        return {
          status: "waiting" as const,
          queueId: row.id,
          fee: row.fee,
          codeLen: row.codeLen,
          mode: parsed.mode,
          kind: parsed.kind,
          groupSize: parsed.groupSize,
          coins,
        };
        }
      }

      const profileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const stateObj = profileRow?.state && typeof profileRow.state === "object" ? (profileRow.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(stateObj);
      if (coins < fee) return { status: "error" as const, error: "insufficient_coins" as const, coins };

      const peakRaw = stateObj.coinsPeak;
      const peak = typeof peakRaw === "number" && Number.isFinite(peakRaw) ? Math.max(0, Math.floor(peakRaw)) : coins;
      const nextCoins = coins - fee;
      const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins) };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

      const opponent = await tx.$queryRaw<{ id: string; email: string; fee: number; codeLen: number }[]>`
        SELECT "id", "email", "fee", "codeLen"
        FROM "OnlineQueue"
        WHERE "mode" = ${modeKey} AND "status" = 'waiting' AND "email" <> ${email}
        ORDER BY "createdAt" ASC
        LIMIT ${groupSize === 4 ? 3 : 1}
        FOR UPDATE SKIP LOCKED
      `;

      if (opponent.length < (groupSize === 4 ? 3 : 1)) {
        const queueId = randomId("q");
        await tx.$executeRaw`
          INSERT INTO "OnlineQueue" ("id", "email", "mode", "fee", "codeLen", "status", "createdAt", "updatedAt")
          VALUES (${queueId}, ${email}, ${modeKey}, ${fee}, ${codeLen}, 'waiting', NOW(), NOW())
        `;
        return { status: "waiting" as const, queueId, fee, codeLen, mode, kind: effectiveKind, groupSize, coins: nextCoins };
      }

      const opp = opponent[0];
      const opp2 = groupSize === 4 ? opponent[1] : null;
      const opp3 = groupSize === 4 ? opponent[2] : null;
      const matchId = randomId("m");
      const answer = effectiveKind === "custom" ? "" : generateAnswer(codeLen);
      const seats = groupSize === 4 ? [opp.email, opp2?.email || "", opp3?.email || "", email] : [opp.email, email];
      const aEmail = seats[0];
      const bEmail = seats[1];
      const cEmail = groupSize === 4 ? seats[2] : null;
      const dEmail = groupSize === 4 ? seats[3] : null;
      const turnEmail = aEmail;
      const turnStartedAt =
        effectiveKind === "custom" ? nowMs() : effectiveKind === "props" && groupSize === 4 ? 0 : groupSize === 4 ? nowMs() : 0;

      if (groupSize === 4 && opp2 && opp3) {
        await tx.$executeRaw`
          UPDATE "OnlineQueue"
          SET "status" = 'matched', "matchId" = ${matchId}, "updatedAt" = NOW()
          WHERE "id" = ${opp.id} OR "id" = ${opp2.id} OR "id" = ${opp3.id}
        `;
      } else {
        await tx.$executeRaw`
          UPDATE "OnlineQueue"
          SET "status" = 'matched', "matchId" = ${matchId}, "updatedAt" = NOW()
          WHERE "id" = ${opp.id}
        `;
      }

      const initialState =
        groupSize === 4
          ? effectiveKind === "props"
            ? {
                kind: "group4",
                propsMode: true,
                phase: "cards",
                deck: generatePropsDeck(),
                pick: { a: null, b: null, c: null, d: null },
                used: { a: false, b: false, c: false, d: false },
                effects: { skipTarget: null, reverseFor: null, hideColorsFor: null, doubleAgainst: null },
                round: 1,
                a: [],
                b: [],
                c: [],
                d: [],
                winners: [],
                forfeits: [],
                lastMasked: null,
              }
            : { kind: "group4", phase: "play", a: [], b: [], c: [], d: [], winners: [], forfeits: [], lastMasked: null }
          : effectiveKind === "custom"
          ? { kind: "custom", phase: "setup", secrets: { a: null, b: null }, ready: { a: false, b: false }, a: [], b: [], lastMasked: null }
          : effectiveKind === "props"
            ? {
                kind: "props",
                phase: "cards",
                deck: generatePropsDeck(),
                pick: { a: null, b: null },
                used: { a: false, b: false },
                effects: { skipTarget: null, reverseFor: null, hideColorsFor: null, doubleAgainst: null },
                round: 1,
                a: [],
                b: [],
                lastMasked: null,
              }
            : { kind: "normal", phase: "waiting", a: [], b: [], lastMasked: null };

      await tx.$executeRaw`
        INSERT INTO "OnlineMatch" ("id", "mode", "fee", "codeLen", "aEmail", "bEmail", "cEmail", "dEmail", "answer", "turnEmail", "turnStartedAt", "state", "createdAt", "updatedAt")
        VALUES (${matchId}, ${mode}, ${fee}, ${codeLen}, ${aEmail}, ${bEmail}, ${cEmail}, ${dEmail}, ${answer}, ${turnEmail}, ${turnStartedAt}, ${JSON.stringify(initialState)}::jsonb, NOW(), NOW())
      `;

      const myQueueId = randomId("q");
      await tx.$executeRaw`
        INSERT INTO "OnlineQueue" ("id", "email", "mode", "fee", "codeLen", "status", "matchId", "createdAt", "updatedAt")
        VALUES (${myQueueId}, ${email}, ${modeKey}, ${fee}, ${codeLen}, 'matched', ${matchId}, NOW(), NOW())
      `;

      const oppProfile = await tx.gameProfile.findUnique({ where: { email: opp.email }, select: { email: true, publicId: true, state: true, createdAt: true } });
      const outMatched = {
        status: "matched" as const,
        matchId,
        fee,
        codeLen,
        mode,
        kind: effectiveKind,
        groupSize,
        coins: nextCoins,
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
      };
      logOnlineEvent({ eventType: "join", userId: email, matchId, connectionId: conn.connectionId, status: "matched" });
      return outMatched;
    });

    if (out.status === "error") return NextResponse.json(out, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

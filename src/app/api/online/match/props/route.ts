import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const TURN_MS = 30_000;

function safeState(raw: unknown) {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const propsMode = s.kind === "props" || s.propsMode === true;
  const kind = propsMode ? ("props" as const) : s.kind === "custom" ? ("custom" as const) : ("normal" as const);
  const phase = kind === "props" && s.phase === "cards" ? ("cards" as const) : kind === "custom" && s.phase === "setup" ? ("setup" as const) : ("play" as const);
  const deck = Array.isArray(s.deck) ? s.deck.filter((x) => typeof x === "string").slice(0, 5) : [];
  const pick = s.pick && typeof s.pick === "object" ? (s.pick as Record<string, unknown>) : {};
  const used = s.used && typeof s.used === "object" ? (s.used as Record<string, unknown>) : {};
  const pickA = typeof pick.a === "number" && Number.isFinite(pick.a) ? Math.max(0, Math.min(4, Math.floor(pick.a))) : null;
  const pickB = typeof pick.b === "number" && Number.isFinite(pick.b) ? Math.max(0, Math.min(4, Math.floor(pick.b))) : null;
  const pickC = typeof pick.c === "number" && Number.isFinite(pick.c) ? Math.max(0, Math.min(4, Math.floor(pick.c))) : null;
  const pickD = typeof pick.d === "number" && Number.isFinite(pick.d) ? Math.max(0, Math.min(4, Math.floor(pick.d))) : null;
  const usedA = used.a === true;
  const usedB = used.b === true;
  const usedC = used.c === true;
  const usedD = used.d === true;
  return { kind, phase, deck, pickA, pickB, pickC, pickD, usedA, usedB, usedC, usedD };
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

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const matchIdRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const actionRaw = body && typeof body === "object" && "action" in body ? (body as { action?: unknown }).action : "";
  const indexRaw = body && typeof body === "object" && "index" in body ? (body as { index?: unknown }).index : null;
  const matchId = String(typeof matchIdRaw === "string" ? matchIdRaw : "").trim();
  const action = String(typeof actionRaw === "string" ? actionRaw : "").trim();
  const index = typeof indexRaw === "number" && Number.isFinite(indexRaw) ? Math.floor(indexRaw) : null;
  if (!matchId || !action) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        {
          id: string;
          fee: number;
          codeLen: number;
          aEmail: string;
          bEmail: string;
          cEmail: string | null;
          dEmail: string | null;
          turnEmail: string;
          turnStartedAt: bigint;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","fee","codeLen","aEmail","bEmail","cEmail","dEmail","turnEmail","turnStartedAt","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email && m.cEmail !== email && m.dEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: false as const, error: "ended" as const };

      const role = m.aEmail === email ? "a" : m.bEmail === email ? "b" : m.cEmail === email ? "c" : "d";
      const state0 = safeState(m.state);
      if (state0.kind !== "props") return { ok: false as const, error: "bad_kind" as const };
      if (!state0.deck.length) return { ok: false as const, error: "no_deck" as const };

      const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
      const nextState: Record<string, unknown> = { ...prevState };

      if (action === "pick") {
        if (state0.phase !== "cards") return { ok: false as const, error: "bad_phase" as const };
        if (index === null || index < 0 || index > 4) return { ok: false as const, error: "bad_index" as const };
        const pick = prevState.pick && typeof prevState.pick === "object" ? (prevState.pick as Record<string, unknown>) : {};
        if (typeof pick[role] === "number") return { ok: true as const, picked: true as const };
        nextState.pick = { ...pick, [role]: index };

        const after = safeState(nextState);
        const roles = ["a", "b", "c", "d"].filter((r) =>
          r === "a" ? !!m.aEmail : r === "b" ? !!m.bEmail : r === "c" ? !!m.cEmail : !!m.dEmail
        );
        const pickedAll =
          roles.length > 0 &&
          roles.every((r) => {
            const val = r === "a" ? after.pickA : r === "b" ? after.pickB : r === "c" ? after.pickC : after.pickD;
            return typeof val === "number";
          });
        if (pickedAll) {
          const now2 = Date.now();
          const turnEmail2 = roles.length ? (roles[now2 % roles.length] === "a" ? m.aEmail : roles[now2 % roles.length] === "b" ? m.bEmail : roles[now2 % roles.length] === "c" ? m.cEmail : m.dEmail) : m.aEmail;
          nextState.phase = "play";
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "turnEmail" = ${turnEmail2}, "turnStartedAt" = ${now2 + 5000}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          return { ok: true as const, picked: true as const, started: true as const };
        }

        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        return { ok: true as const, picked: true as const };
      }

      if (action === "use") {
        if (state0.phase !== "play") return { ok: false as const, error: "bad_phase" as const };
        const now = Date.now();
        const startedAt = Number(m.turnStartedAt || 0);
        if (startedAt > 0 && now - startedAt >= TURN_MS) return { ok: false as const, error: "turn_expired" as const };
        if (m.turnEmail !== email) return { ok: false as const, error: "not_your_turn" as const };
        const used = prevState.used && typeof prevState.used === "object" ? (prevState.used as Record<string, unknown>) : {};
        if (used[role] === true) return { ok: false as const, error: "already_used" as const };
        const pickA = state0.pickA;
        const pickB = state0.pickB;
        const pickC = state0.pickC;
        const pickD = state0.pickD;
        const idx = role === "a" ? pickA : role === "b" ? pickB : role === "c" ? pickC : pickD;
        if (idx === null) return { ok: false as const, error: "not_picked" as const };
        const card = state0.deck[idx] || "";
        if (!card) return { ok: false as const, error: "bad_card" as const };

        const effects = prevState.effects && typeof prevState.effects === "object" ? (prevState.effects as Record<string, unknown>) : {};
        const targetRaw = body && typeof body === "object" && "target" in body ? (body as { target?: unknown }).target : "";
        const target = String(typeof targetRaw === "string" ? targetRaw : "").trim();
        const isGroup = !!m.cEmail || !!m.dEmail;
        const targetRole =
          target === "a" || target === "b" || target === "c" || target === "d"
            ? target
            : isGroup
              ? ""
              : role === "a"
                ? "b"
                : "a";
        if (targetRole !== "a" && targetRole !== "b" && targetRole !== "c" && targetRole !== "d") return { ok: false as const, error: "bad_target" as const };
        const targetEmail =
          targetRole === "a" ? m.aEmail : targetRole === "b" ? m.bEmail : targetRole === "c" ? m.cEmail : m.dEmail;
        if (!targetEmail || targetRole === role) return { ok: false as const, error: "bad_target" as const };
        const nextEffects: Record<string, unknown> = { ...effects };
        if (card === "skip_turn") nextEffects.skipTarget = targetRole;
        else if (card === "reverse_digits") nextEffects.reverseFor = targetRole;
        else if (card === "hide_colors") nextEffects.hideColorsFor = targetRole;
        else if (card === "double_or_nothing") nextEffects.doubleAgainst = targetRole;
        nextState.effects = nextEffects;
        nextState.used = { ...used, [role]: true };

        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
        const myCoins = readCoinsFromState(myState);
        return { ok: true as const, used: true as const, card, coins: myCoins };
      }

      return { ok: false as const, error: "bad_action" as const };
    });

    if (!out.ok) {
      const status = out.error === "forbidden" ? 403 : out.error === "not_found" ? 404 : 409;
      return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const TURN_MS = 30_000;
const STALE_START_MS = 180_000;
const STALE_GROUP_MS = 600_000;
const DISCONNECT_GRACE_MS = 60_000;
const OFFLINE_MARK_MS = 12_000;
const PRESENCE_MIN_WRITE_MS = 2500;

function ensureStats(state: Record<string, unknown>) {
  const raw = state.stats && typeof state.stats === "object" ? (state.stats as Record<string, unknown>) : {};
  const num = (k: string) => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  };
  return {
    wins: num("wins"),
    attempts: num("attempts"),
    streakNoHint: num("streakNoHint"),
    bestNoHint: num("bestNoHint"),
    winStreak: num("winStreak"),
    bestWinStreak: num("bestWinStreak"),
    winsNormal: num("winsNormal"),
    winsTimed: num("winsTimed"),
    winsLimited: num("winsLimited"),
    winsDaily: num("winsDaily"),
    winsOnline: num("winsOnline"),
    winsOnlineEasy: num("winsOnlineEasy"),
    winsOnlineMedium: num("winsOnlineMedium"),
    winsOnlineHard: num("winsOnlineHard"),
  };
}

function safeObj(raw: unknown) {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizePresenceState(state: unknown) {
  const base = safeObj(state);
  const presence = safeObj(base.presence);
  const a = safeObj(presence.a);
  const b = safeObj(presence.b);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const normSide = (side: Record<string, unknown>) => ({
    lastSeenAt: num(side.lastSeenAt),
    disconnectedAt: num(side.disconnectedAt),
  });
  return { base, presence: { a: normSide(a), b: normSide(b) } };
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

function safeState(raw: unknown) {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(s.a) ? s.a : [];
  const b = Array.isArray(s.b) ? s.b : [];
  const c = Array.isArray(s.c) ? s.c : [];
  const d = Array.isArray(s.d) ? s.d : [];
  const lastMasked = s.lastMasked && typeof s.lastMasked === "object" ? (s.lastMasked as Record<string, unknown>) : null;
  const endedReason = typeof s.endedReason === "string" ? s.endedReason : null;
  const forfeitedBy = typeof s.forfeitedBy === "string" ? s.forfeitedBy : null;
  const kind =
    s.kind === "custom" ? ("custom" as const) : s.kind === "props" ? ("props" as const) : s.kind === "group4" ? ("group4" as const) : ("normal" as const);
  const propsMode = s.propsMode === true;
  const phase =
    kind === "custom" && s.phase === "setup"
      ? ("setup" as const)
      : (kind === "props" || propsMode) && s.phase === "cards"
        ? ("cards" as const)
        : kind === "normal" && s.phase === "waiting"
          ? ("waiting" as const)
          : ("play" as const);
  const winners = Array.isArray(s.winners) ? s.winners.filter((x) => typeof x === "string") : [];
  const forfeits = Array.isArray(s.forfeits) ? s.forfeits.filter((x) => typeof x === "string") : [];
  const secrets = s.secrets && typeof s.secrets === "object" ? (s.secrets as Record<string, unknown>) : {};
  const ready = s.ready && typeof s.ready === "object" ? (s.ready as Record<string, unknown>) : {};
  const secretA = typeof secrets.a === "string" ? secrets.a : "";
  const secretB = typeof secrets.b === "string" ? secrets.b : "";
  const hasSecretA = secretA.length > 0;
  const hasSecretB = secretB.length > 0;
  const readyA = ready.a === true;
  const readyB = ready.b === true;
  const deck = Array.isArray(s.deck) ? s.deck.filter((x) => typeof x === "string").slice(0, 5) : [];
  const pick = s.pick && typeof s.pick === "object" ? (s.pick as Record<string, unknown>) : {};
  const used = s.used && typeof s.used === "object" ? (s.used as Record<string, unknown>) : {};
  const effects = s.effects && typeof s.effects === "object" ? (s.effects as Record<string, unknown>) : {};
  const pickA = typeof pick.a === "number" && Number.isFinite(pick.a) ? Math.max(0, Math.min(4, Math.floor(pick.a))) : null;
  const pickB = typeof pick.b === "number" && Number.isFinite(pick.b) ? Math.max(0, Math.min(4, Math.floor(pick.b))) : null;
  const pickC = typeof pick.c === "number" && Number.isFinite(pick.c) ? Math.max(0, Math.min(4, Math.floor(pick.c))) : null;
  const pickD = typeof pick.d === "number" && Number.isFinite(pick.d) ? Math.max(0, Math.min(4, Math.floor(pick.d))) : null;
  const usedA = used.a === true;
  const usedB = used.b === true;
  const usedC = used.c === true;
  const usedD = used.d === true;
  const roleVals = ["a", "b", "c", "d"];
  const skipTarget = roleVals.includes(String(effects.skipTarget)) ? (effects.skipTarget as "a" | "b" | "c" | "d") : null;
  const skipBy = effects.skipBy === "a" || effects.skipBy === "b" ? (effects.skipBy as "a" | "b") : null;
  const reverseFor = roleVals.includes(String(effects.reverseFor)) ? (effects.reverseFor as "a" | "b" | "c" | "d") : null;
  const hideColorsFor = roleVals.includes(String(effects.hideColorsFor)) ? (effects.hideColorsFor as "a" | "b" | "c" | "d") : null;
  const doubleAgainst = roleVals.includes(String(effects.doubleAgainst)) ? (effects.doubleAgainst as "a" | "b" | "c" | "d") : null;
  const resolvedSkipTarget = skipTarget ? skipTarget : skipBy && kind !== "group4" ? (skipBy === "a" ? "b" : "a") : null;
  return {
    a,
    b,
    c,
    d,
    lastMasked,
    endedReason,
    forfeitedBy,
    kind,
    propsMode,
    phase,
    winners,
    forfeits,
    secretA,
    secretB,
    hasSecretA,
    hasSecretB,
    readyA,
    readyB,
    deck,
    pickA,
    pickB,
    pickC,
    pickD,
    usedA,
    usedB,
    usedC,
    usedD,
    skipTarget: resolvedSkipTarget,
    reverseFor,
    hideColorsFor,
    doubleAgainst,
  };
}

function nextGroup4Turn(emails: (string | null)[], current: string, state: ReturnType<typeof safeState>) {
  const order = emails.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!order.length) return current;
  const finished = new Set<string>([...state.winners, ...state.forfeits]);
  const start = Math.max(0, order.indexOf(current));
  for (let i = 1; i <= order.length; i++) {
    const next = order[(start + i) % order.length];
    if (!finished.has(next)) return next;
  }
  return current;
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

  const ban = await getActiveBan(email);
  if (ban) return NextResponse.json({ error: "banned", bannedUntilMs: ban.bannedUntilMs, reason: ban.reason }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const conn = await requireActiveConnection(req, email);
  if (!conn.ok) return NextResponse.json({ error: conn.error }, { status: 409, headers: { "Cache-Control": "no-store" } });

  const matchId = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!matchId) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const onlineEnabled = await getOnlineEnabled();

  try {
    await ensureGameProfile(email);

    type MatchRow = {
      id: string;
      mode: string;
      fee: number;
      codeLen: number;
      aEmail: string;
      bEmail: string;
      cEmail: string | null;
      dEmail: string | null;
      answer: string;
      turnEmail: string;
      turnStartedAt: bigint;
      winnerEmail: string | null;
      endedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      state: unknown;
    };

      const baseRows = await prisma.$queryRaw<MatchRow[]>`
        SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","createdAt","updatedAt","state"
      FROM "OnlineMatch"
      WHERE "id" = ${matchId}
      LIMIT 1
    `;
    let m = baseRows && baseRows[0] ? baseRows[0] : null;
    if (!m) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (m.aEmail !== email && m.bEmail !== email && m.cEmail !== email && m.dEmail !== email)
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });

    const isStalePreStart = (row: MatchRow) => {
      if (row.endedAt) return false;
      const s = safeState(row.state);
      if (s.phase === "play") return false;
      return s.phase === "setup" || s.phase === "cards" || s.phase === "waiting";
    };
    const lastActivityMs = Math.max(m.updatedAt ? m.updatedAt.getTime() : 0, m.createdAt ? m.createdAt.getTime() : 0);
    const isStale = !m.endedAt && lastActivityMs > 0 && Date.now() - lastActivityMs > STALE_START_MS && isStalePreStart(m);

    if (isStale) {
      m = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","createdAt","updatedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.endedAt) return locked;
        const lockedLastMs = Math.max(locked.updatedAt ? locked.updatedAt.getTime() : 0, locked.createdAt ? locked.createdAt.getTime() : 0);
        if (!isStalePreStart(locked) || Date.now() - lockedLastMs <= STALE_START_MS) return locked;

        const prev = locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {};
        const nextState = { ...prev, endedReason: "stale", forfeitedBy: null, endedAt: Date.now() };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        const refund = async (who: string | null) => {
          if (!who) return;
          const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(locked.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(locked.aEmail);
        await refund(locked.bEmail);
        await refund(locked.cEmail);
        await refund(locked.dEmail);
        return { ...locked, endedAt: new Date(), winnerEmail: null, state: nextState };
      });
      if (!m)
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    if (!onlineEnabled && !m.endedAt) {
      m = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","createdAt","updatedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email && locked.cEmail !== email && locked.dEmail !== email) return null;
        if (locked.endedAt) return locked;

        const nextState = normalizeStateForDisabled(locked.state);
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
          const fee = Math.max(0, Math.floor(locked.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(locked.aEmail);
        await refund(locked.bEmail);

        return { ...locked, winnerEmail: null, endedAt: new Date(), state: nextState };
      });

      if (!m)
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    const match = m;
    const state0 = safeState(match.state);
    const now = Date.now();
    const lastActivityMs2 = Math.max(match.updatedAt ? match.updatedAt.getTime() : 0, match.createdAt ? match.createdAt.getTime() : 0);
    const group4Stale = state0.kind === "group4" && !match.endedAt && lastActivityMs2 > 0 && now - lastActivityMs2 > STALE_GROUP_MS;
    if (group4Stale) {
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","createdAt","updatedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email && locked.cEmail !== email && locked.dEmail !== email) return null;
        if (locked.endedAt || locked.winnerEmail) return locked;
        const lockedState = safeState(locked.state);
        const lockedLastMs = Math.max(locked.updatedAt ? locked.updatedAt.getTime() : 0, locked.createdAt ? locked.createdAt.getTime() : 0);
        if (lockedState.kind !== "group4" || !(lockedLastMs > 0 && Date.now() - lockedLastMs > STALE_GROUP_MS)) return locked;

        const prev = locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {};
        const nextState = { ...prev, endedReason: "stale", forfeitedBy: null, endedAt: Date.now() };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        const refund = async (who: string | null) => {
          if (!who) return;
          const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(locked.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(locked.aEmail);
        await refund(locked.bEmail);
        await refund(locked.cEmail);
        await refund(locked.dEmail);
        return { ...locked, winnerEmail: null, endedAt: new Date(), state: nextState };
      });
      if (updated) m = updated;
    }
    const turnStartedAt0 = Number(match.turnStartedAt || 0);
    const needExpire = state0.phase === "play" && !match.endedAt && turnStartedAt0 > 0 && now - turnStartedAt0 >= TURN_MS;
    const needCustomStart = state0.kind === "custom" && state0.phase === "setup" && state0.readyA && state0.readyB && !match.endedAt;
    const propsRoles = ["a", "b", "c", "d"].filter((r) =>
      r === "a" ? !!match.aEmail : r === "b" ? !!match.bEmail : r === "c" ? !!match.cEmail : !!match.dEmail
    );
    const propsReady =
      (state0.kind === "props" || state0.propsMode) &&
      state0.phase === "cards" &&
      propsRoles.every((r) => {
        const val = r === "a" ? state0.pickA : r === "b" ? state0.pickB : r === "c" ? state0.pickC : state0.pickD;
        return typeof val === "number";
      });
    const needPropsStart = propsReady && !match.endedAt;
    const needNormalStart = state0.kind === "normal" && state0.phase === "waiting" && !match.endedAt;

    if (needExpire || needCustomStart || needPropsStart || needNormalStart) {
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","createdAt","updatedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email && locked.cEmail !== email && locked.dEmail !== email) return null;

        const stateForTurn = safeState(locked.state);
        const now2 = Date.now();
        const turnStartedAt = Number(locked.turnStartedAt || 0);
        const expired = stateForTurn.phase === "play" && !locked.endedAt && turnStartedAt > 0 && now2 - turnStartedAt >= TURN_MS;
        if (expired) {
          const nextTurn =
            stateForTurn.kind === "group4"
              ? nextGroup4Turn([locked.aEmail, locked.bEmail, locked.cEmail, locked.dEmail], locked.turnEmail, stateForTurn)
              : locked.turnEmail === locked.aEmail
                ? locked.bEmail
                : locked.aEmail;
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now2}, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          locked.turnEmail = nextTurn;
          locked.turnStartedAt = BigInt(now2);
        }

        let nextStateForReturn: unknown = locked.state;
        let stateAfter = stateForTurn;
        if (stateAfter.kind === "custom" && stateAfter.phase === "setup" && stateAfter.readyA && stateAfter.readyB && !locked.endedAt) {
          const now3 = Date.now();
          const aStarts = (now3 & 1) === 1;
          const turnEmail2 = aStarts ? locked.aEmail : locked.bEmail;
          const nextState = { ...(locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {}), phase: "play" };
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "turnEmail" = ${turnEmail2}, "turnStartedAt" = ${now3}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          locked.turnEmail = turnEmail2;
          locked.turnStartedAt = BigInt(now3);
          nextStateForReturn = nextState;
          stateAfter = safeState(nextStateForReturn);
        }
        if ((stateAfter.kind === "props" || stateAfter.propsMode) && stateAfter.phase === "cards" && !locked.endedAt) {
          const roles = ["a", "b", "c", "d"].filter((r) =>
            r === "a" ? !!locked.aEmail : r === "b" ? !!locked.bEmail : r === "c" ? !!locked.cEmail : !!locked.dEmail
          );
          const ready = roles.every((r) => {
            const val = r === "a" ? stateAfter.pickA : r === "b" ? stateAfter.pickB : r === "c" ? stateAfter.pickC : stateAfter.pickD;
            return typeof val === "number";
          });
          if (!ready) {
            return locked;
          }
          const now3 = Date.now();
          const pickRole = roles.length ? roles[now3 % roles.length] : "a";
          const turnEmail2 =
            (pickRole === "a" ? locked.aEmail : pickRole === "b" ? locked.bEmail : pickRole === "c" ? locked.cEmail : locked.dEmail) ||
            locked.aEmail;
          const nextState = { ...(locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {}), phase: "play" };
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "turnEmail" = ${turnEmail2}, "turnStartedAt" = ${now3 + 5000}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          locked.turnEmail = turnEmail2;
          locked.turnStartedAt = BigInt(now3 + 5000);
          nextStateForReturn = nextState;
        }

        if (stateAfter.kind === "normal" && stateAfter.phase === "waiting" && !locked.endedAt && Number(locked.turnStartedAt || 0) <= 0) {
          const now3 = Date.now();
          const { presence } = normalizePresenceState(locked.state);
          const readyWindowMs = 20_000;
          const readyA = presence.a.lastSeenAt > 0 && !presence.a.disconnectedAt && now3 - presence.a.lastSeenAt < readyWindowMs;
          const readyB = presence.b.lastSeenAt > 0 && !presence.b.disconnectedAt && now3 - presence.b.lastSeenAt < readyWindowMs;
          if (readyA && readyB) {
            const aStarts = (now3 & 1) === 1;
            const turnEmail2 = aStarts ? locked.aEmail : locked.bEmail;
            const nextState = { ...(locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {}), phase: "play" };
            await tx.$executeRaw`
              UPDATE "OnlineMatch"
              SET "turnEmail" = ${turnEmail2}, "turnStartedAt" = ${now3 + 5000}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
              WHERE "id" = ${matchId}
            `;
            locked.turnEmail = turnEmail2;
            locked.turnStartedAt = BigInt(now3 + 5000);
            nextStateForReturn = nextState;
          }
        }

        locked.state = nextStateForReturn;
        return locked;
      });
      if (updated) m = updated;
    }

    if (!m.endedAt && !m.winnerEmail && state0.kind !== "group4") {
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","updatedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email && locked.cEmail !== email && locked.dEmail !== email) return null;
        if (locked.endedAt || locked.winnerEmail) return locked;

        const now2 = Date.now();
        const role = locked.aEmail === email ? ("a" as const) : ("b" as const);
        const oppEmail = role === "a" ? locked.bEmail : locked.aEmail;

        const { base, presence } = normalizePresenceState(locked.state);
        const me = role === "a" ? presence.a : presence.b;
        const opp = role === "a" ? presence.b : presence.a;

        const nextMe = {
          lastSeenAt: now2,
          disconnectedAt: 0,
        };
        const shouldWriteMe = !!me.disconnectedAt || !me.lastSeenAt || now2 - me.lastSeenAt >= PRESENCE_MIN_WRITE_MS;

        let nextOpp = opp;
        const oppSilenceMs = opp.lastSeenAt ? now2 - opp.lastSeenAt : 0;
        if (!opp.disconnectedAt && opp.lastSeenAt && oppSilenceMs >= OFFLINE_MARK_MS) {
          nextOpp = { ...opp, disconnectedAt: now2 };
        }

        const nextPresence =
          role === "a"
            ? { a: shouldWriteMe ? nextMe : presence.a, b: nextOpp }
            : { a: nextOpp, b: shouldWriteMe ? nextMe : presence.b };

        const nextState = { ...base, presence: nextPresence };

        const discAt = nextOpp.disconnectedAt || 0;
        if (discAt && now2 - discAt >= DISCONNECT_GRACE_MS) {
          const prevState = locked.state && typeof locked.state === "object" ? (locked.state as Record<string, unknown>) : {};
          const kind = prevState.kind === "custom" ? ("custom" as const) : ("normal" as const);
          const phase = kind === "custom" && prevState.phase === "setup" ? ("setup" as const) : ("play" as const);
          const fee = Math.max(0, Math.floor(locked.fee));
          const isSetupCancel = kind === "custom" && phase === "setup";
          const endedState = { ...nextState, endedReason: "disconnect", forfeitedBy: oppEmail, forfeitedAt: now2 };

          if (isSetupCancel) {
            await tx.$executeRaw`
              UPDATE "OnlineMatch"
              SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(endedState)}::jsonb, "updatedAt" = NOW()
              WHERE "id" = ${matchId}
            `;
            const refund = async (who: string) => {
              const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
              const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
              const coins = readCoinsFromState(stateObj);
              const peak = readCoinsPeakFromState(stateObj);
              const nextCoins = coins + fee;
              const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: now2 };
              await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
            };
            await refund(locked.aEmail);
            await refund(locked.bEmail);
            return { ...locked, winnerEmail: null, endedAt: new Date(), state: endedState };
          }

          const winnerEmail = email;
          const loserEmail = oppEmail;
          const pot = fee * 2;

          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "winnerEmail" = ${winnerEmail}, "endedAt" = NOW(), "state" = ${JSON.stringify(endedState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;

          const [winnerProfile, loserProfile] = await Promise.all([
            tx.gameProfile.findUnique({ where: { email: winnerEmail }, select: { state: true } }),
            tx.gameProfile.findUnique({ where: { email: loserEmail }, select: { state: true } }),
          ]);

          const wState = winnerProfile?.state && typeof winnerProfile.state === "object" ? (winnerProfile.state as Record<string, unknown>) : {};
          const wCoins = readCoinsFromState(wState);
          const wPeak = readCoinsPeakFromState(wState);
          const wEarned = typeof wState.coinsEarnedTotal === "number" && Number.isFinite(wState.coinsEarnedTotal) ? Math.max(0, Math.floor(wState.coinsEarnedTotal)) : 0;
          const wStats = ensureStats(wState);
          wStats.wins += 1;
          wStats.winsOnline += 1;
          if (locked.mode === "easy") wStats.winsOnlineEasy += 1;
          else if (locked.mode === "medium") wStats.winsOnlineMedium += 1;
          else if (locked.mode === "hard") wStats.winsOnlineHard += 1;
          wStats.winStreak += 1;
          wStats.bestWinStreak = Math.max(wStats.bestWinStreak, wStats.winStreak);
          const wNextCoins = wCoins + pot;
          const wUpdated = { ...wState, coins: wNextCoins, coinsEarnedTotal: wEarned + pot, coinsPeak: Math.max(wPeak, wNextCoins), stats: wStats, lastWriteAt: now2 };

          const lState = loserProfile?.state && typeof loserProfile.state === "object" ? (loserProfile.state as Record<string, unknown>) : {};
          const lStats = ensureStats(lState);
          lStats.winStreak = 0;
          const lUpdated = { ...lState, stats: lStats, lastWriteAt: now2 };

          await Promise.all([
            tx.gameProfile.update({ where: { email: winnerEmail }, data: { state: wUpdated } }),
            tx.gameProfile.update({ where: { email: loserEmail }, data: { state: lUpdated } }),
          ]);

          return { ...locked, winnerEmail, endedAt: new Date(), state: endedState };
        }

        if (shouldWriteMe || nextOpp !== opp) {
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          locked.state = nextState;
        }

        return locked;
      });

      if (updated) m = updated;
    }

    const state = safeState(m.state);
    const myRole = m.aEmail === email ? "a" : m.bEmail === email ? "b" : m.cEmail === email ? "c" : "d";
    const myHistory = (myRole === "a" ? state.a : myRole === "b" ? state.b : myRole === "c" ? state.c : state.d)
      .filter((x) => x && typeof x === "object")
      .slice(-120);

    const myProfile = await prisma.gameProfile.findUnique({ where: { email }, select: { state: true, publicId: true } });
    const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
    const myCoins = readCoinsFromState(myState);
    const myLevel = getProfileLevel(myProfile?.state).level;

    const serverNowMs = Date.now();
    const turnStartedAtMs = Number(m.turnStartedAt || 0);
    const elapsedMs = turnStartedAtMs > 0 ? Math.max(0, serverNowMs - turnStartedAtMs) : 0;
    const timeLeftMs = m.endedAt || state.phase !== "play" ? 0 : Math.max(0, TURN_MS - elapsedMs);

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

    if (state.kind === "group4") {
      const seatMap: Record<string, "right" | "top" | "left" | "bottom"> = { a: "right", b: "top", c: "left", d: "bottom" };
      const roles = [
        { role: "a", email: m.aEmail },
        { role: "b", email: m.bEmail },
        { role: "c", email: m.cEmail || "" },
        { role: "d", email: m.dEmail || "" },
      ].filter((x) => x.email);
      const emails = roles.map((x) => x.email);
      const profiles = await prisma.gameProfile.findMany({ where: { email: { in: emails } }, select: { email: true, publicId: true, state: true, createdAt: true } });
      const map = new Map(profiles.map((p) => [p.email, p]));
      const rankList = [...state.winners, ...state.forfeits];
      const rankMap = new Map(rankList.map((e, i) => [e, i + 1]));
      const players = roles.map((r) => {
        const p = map.get(r.email);
        const rank = rankMap.get(r.email) || null;
        const won = state.winners.includes(r.email);
        const lost = state.forfeits.includes(r.email) || (isEnded && !won);
        return {
          role: r.role,
          seat: seatMap[r.role],
          email: r.email,
          id: p?.publicId || null,
          firstName: p ? firstNameFromDisplayNameOrEmail(readDisplayNameFromState(p.state), p.email) : firstNameFromEmail(r.email),
          photo: p ? readPhotoFromState(p.state) : "",
          level: p ? getProfileLevel(p.state).level : 1,
          stats: p ? getProfileStats(p.state) : null,
          rank,
          status: won ? "won" : lost ? "lost" : "playing",
        };
      });
      const isProps = state.propsMode === true;
      const picks = isProps
        ? { a: state.pickA, b: state.pickB, c: state.pickC, d: state.pickD }
        : null;
      const myPick = isProps ? (myRole === "a" ? state.pickA : myRole === "b" ? state.pickB : myRole === "c" ? state.pickC : state.pickD) : null;
      const myCard = isProps && typeof myPick === "number" ? state.deck[myPick] || null : null;
      const myUsed = isProps ? (myRole === "a" ? state.usedA : myRole === "b" ? state.usedB : myRole === "c" ? state.usedC : state.usedD) : null;
      return NextResponse.json(
        {
          ok: true as const,
          match: {
            id: m.id,
            mode: m.mode,
            fee: m.fee,
            codeLen: m.codeLen,
            kind: isProps ? "props" : state.kind,
            phase: state.phase,
            groupSize: 4,
            players,
            deck: isProps ? state.deck : null,
            picks,
            myPick,
            myCard,
            myUsed,
            myRole,
            myId: myProfile?.publicId || null,
            myCoins,
            myLevel,
            turn: m.endedAt ? "ended" : isProps && state.phase === "cards" ? "setup" : m.turnEmail === email ? "me" : "other",
            turnRole: roles.find((r) => r.email === m.turnEmail)?.role || null,
            turnEmail: m.turnEmail,
            timeLeftMs: state.phase === "cards" ? 0 : timeLeftMs,
            serverNowMs,
            turnStartedAtMs,
            endedAt: m.endedAt ? m.endedAt.toISOString() : null,
            endedReason: state.endedReason,
            solution,
            winners: state.winners,
            forfeits: state.forfeits,
            myHistory,
            lastMasked,
          },
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const oppEmail = m.aEmail === email ? m.bEmail : m.aEmail;
    const oppProfile = await prisma.gameProfile.findUnique({ where: { email: oppEmail }, select: { email: true, publicId: true, state: true, createdAt: true } });

    return NextResponse.json(
      {
        ok: true as const,
        match: {
          id: m.id,
          mode: m.mode,
          fee: m.fee,
          codeLen: m.codeLen,
          kind: state.kind,
          phase: state.phase,
          groupSize: 2,
          myReady: myRole === "a" ? state.readyA : state.readyB,
          oppReady: myRole === "a" ? state.readyB : state.readyA,
          myHasSecret: myRole === "a" ? state.hasSecretA : state.hasSecretB,
          oppHasSecret: myRole === "a" ? state.hasSecretB : state.hasSecretA,
          deck: state.kind === "props" ? state.deck : null,
          myPick: state.kind === "props" ? (myRole === "a" ? state.pickA : state.pickB) : null,
          oppPick: state.kind === "props" ? (myRole === "a" ? state.pickB : state.pickA) : null,
          myCard:
            state.kind === "props"
              ? myRole === "a"
                ? state.pickA !== null
                  ? state.deck[state.pickA] || null
                  : null
                : state.pickB !== null
                  ? state.deck[state.pickB] || null
                  : null
              : null,
          oppCard:
            state.kind === "props"
              ? myRole === "a"
                ? state.pickB !== null
                  ? state.deck[state.pickB] || null
                  : null
                : state.pickA !== null
                  ? state.deck[state.pickA] || null
                  : null
              : null,
          myUsed: state.kind === "props" ? (myRole === "a" ? state.usedA : state.usedB) : null,
          oppUsed: state.kind === "props" ? (myRole === "a" ? state.usedB : state.usedA) : null,
          myRole,
          myId: myProfile?.publicId || null,
          myCoins,
          myLevel,
          turn: m.endedAt
            ? "ended"
            : state.phase === "waiting" || state.phase === "setup" || state.phase === "cards"
              ? "setup"
              : m.turnEmail === email
                ? "me"
                : "them",
          timeLeftMs,
          serverNowMs,
          turnStartedAtMs,
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
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsEarnedTotalFromState, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const TURN_MS = 30_000;

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

function isDigitsN(s: string, len: number) {
  if (typeof s !== "string") return false;
  if (s.length !== len) return false;
  return /^\d+$/.test(s);
}

function evaluateGuess(guess: string, answer: string) {
  const g = guess.split("");
  const a = answer.split("");
  const len = answer.length;
  const result = Array(len).fill("bad");
  const remaining: Record<string, number> = {};

  for (let i = 0; i < len; i++) {
    if (g[i] === a[i]) {
      result[i] = "ok";
    } else {
      remaining[a[i]] = (remaining[a[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < len; i++) {
    if (result[i] === "ok") continue;
    const d = g[i];
    if ((remaining[d] || 0) > 0) {
      result[i] = "warn";
      remaining[d] -= 1;
    }
  }

  return result as ("ok" | "warn" | "bad")[];
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

function safeState(raw: unknown) {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(s.a) ? s.a : [];
  const b = Array.isArray(s.b) ? s.b : [];
  const c = Array.isArray(s.c) ? s.c : [];
  const d = Array.isArray(s.d) ? s.d : [];
  const lastMasked = s.lastMasked && typeof s.lastMasked === "object" ? (s.lastMasked as Record<string, unknown>) : null;
  const kind =
    s.kind === "custom" ? ("custom" as const) : s.kind === "props" ? ("props" as const) : s.kind === "group4" ? ("group4" as const) : ("normal" as const);
  const propsMode = s.propsMode === true;
  const phase =
    kind === "custom" && s.phase === "setup" ? ("setup" as const) : (kind === "props" || propsMode) && s.phase === "cards" ? ("cards" as const) : ("play" as const);
  const winners = Array.isArray(s.winners) ? s.winners.filter((x) => typeof x === "string") : [];
  const forfeits = Array.isArray(s.forfeits) ? s.forfeits.filter((x) => typeof x === "string") : [];
  const secrets = s.secrets && typeof s.secrets === "object" ? (s.secrets as Record<string, unknown>) : {};
  const ready = s.ready && typeof s.ready === "object" ? (s.ready as Record<string, unknown>) : {};
  const secretA = typeof secrets.a === "string" ? secrets.a : "";
  const secretB = typeof secrets.b === "string" ? secrets.b : "";
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
    kind,
    propsMode,
    phase,
    winners,
    forfeits,
    secretA,
    secretB,
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

function group4PayoutForRank(rank: number, fee: number) {
  const f = Math.max(0, Math.floor(fee));
  if (rank === 1) return f * 4;
  if (rank === 2) return f * 3;
  if (rank === 3) return f * 2;
  return 0;
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

  const matchIdRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const guessRaw = body && typeof body === "object" && "guess" in body ? (body as { guess?: unknown }).guess : "";
  const matchId = String(typeof matchIdRaw === "string" ? matchIdRaw : "").trim();
  const guess = String(typeof guessRaw === "string" ? guessRaw : "").trim();
  if (!matchId || !guess) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });

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
          cEmail: string | null;
          dEmail: string | null;
          answer: string;
          turnEmail: string;
          turnStartedAt: bigint;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","mode","fee","codeLen","aEmail","bEmail","cEmail","dEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email && m.cEmail !== email && m.dEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: false as const, error: "ended" as const };

      const now = Date.now();
      const turnStartedAt = Number(m.turnStartedAt || 0);
      const state0 = safeState(m.state);
      if (state0.phase === "play" && turnStartedAt > 0 && now - turnStartedAt >= TURN_MS) {
        const nextTurn =
          state0.kind === "group4"
            ? nextGroup4Turn([m.aEmail, m.bEmail, m.cEmail, m.dEmail], m.turnEmail, state0)
            : m.turnEmail === m.aEmail
              ? m.bEmail
              : m.aEmail;
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        m.turnEmail = nextTurn;
        m.turnStartedAt = BigInt(now);
      }

      if (m.turnEmail !== email) return { ok: false as const, error: "not_your_turn" as const };

      const len = Math.max(3, Math.min(6, Math.floor(m.codeLen || 0)));
      if (!isDigitsN(guess, len)) return { ok: false as const, error: "bad_guess" as const };

      const role = m.aEmail === email ? "a" : m.bEmail === email ? "b" : m.cEmail === email ? "c" : "d";
      if (state0.kind === "group4") {
        if (state0.winners.includes(email) || state0.forfeits.includes(email)) return { ok: false as const, error: "already_finished" as const };
        const targetAnswer = m.answer;
        if (!targetAnswer || !isDigitsN(targetAnswer, len)) return { ok: false as const, error: "not_ready" as const };
        if (state0.propsMode && state0.phase !== "play") return { ok: false as const, error: "not_ready" as const };
        const effectiveGuess = state0.propsMode && state0.reverseFor === role ? guess.split("").reverse().join("") : guess;
        const rawResult = evaluateGuess(effectiveGuess, targetAnswer);
        const solved = rawResult.every((x) => x === "ok");
        const hideColors = state0.propsMode && state0.hideColorsFor === role;
        const result = hideColors ? Array(len).fill("mask") : rawResult;
        const entry = { guess, result, at: now };
        const nextA = role === "a" ? (state0.a as unknown[]).concat([entry]).slice(-160) : (state0.a as unknown[]).slice(-160);
        const nextB = role === "b" ? (state0.b as unknown[]).concat([entry]).slice(-160) : (state0.b as unknown[]).slice(-160);
        const nextC = role === "c" ? (state0.c as unknown[]).concat([entry]).slice(-160) : (state0.c as unknown[]).slice(-160);
        const nextD = role === "d" ? (state0.d as unknown[]).concat([entry]).slice(-160) : (state0.d as unknown[]).slice(-160);

        const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
        const nextState: Record<string, unknown> = {
          ...prevState,
          a: nextA,
          b: nextB,
          c: nextC,
          d: nextD,
          winners: state0.winners,
          forfeits: state0.forfeits,
          lastMasked: { by: email, len, at: now },
        };

        if (state0.propsMode && solved && state0.doubleAgainst === role) {
          const newAnswer = generateAnswer(len);
          const eff = prevState.effects && typeof prevState.effects === "object" ? (prevState.effects as Record<string, unknown>) : {};
          nextState.effects = { ...eff, doubleAgainst: null };
          nextState.a = [];
          nextState.b = [];
          nextState.c = [];
          nextState.d = [];
          nextState.lastMasked = null;
          nextState.round =
            typeof (prevState as Record<string, unknown>).round === "number" ? Math.floor((prevState as Record<string, unknown>).round as number) + 1 : 2;

          const nextTurn = nextGroup4Turn([m.aEmail, m.bEmail, m.cEmail, m.dEmail], m.turnEmail, state0);
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "answer" = ${newAnswer}, "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${matchId}
          `;
          const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
          const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
          const myCoins = readCoinsFromState(myState);
          return { ok: true as const, solved: false as const, result, nextTurn: "other" as const, coins: myCoins, doubleOrNothing: true as const };
        }

        const winners = state0.winners.slice();
        let rank: number | null = null;
        if (solved && !winners.includes(email)) {
          winners.push(email);
          rank = winners.length;
        }

        const payout = rank ? group4PayoutForRank(rank, m.fee) : 0;
        if (rank && payout > 0) {
          const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
          const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
          const myCoins = readCoinsFromState(myState);
          const myEarned = readCoinsEarnedTotalFromState(myState);
          const myPeak = readCoinsPeakFromState(myState);
          const stats = ensureStats(myState);
          stats.wins += 1;
          stats.winsOnline += 1;
          if (m.mode === "easy") stats.winsOnlineEasy += 1;
          else if (m.mode === "medium") stats.winsOnlineMedium += 1;
          else if (m.mode === "hard") stats.winsOnlineHard += 1;
          stats.winStreak += 1;
          stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.winStreak);
          const nextCoins = myCoins + payout;
          const updated = {
            ...myState,
            coins: nextCoins,
            coinsEarnedTotal: myEarned + payout,
            coinsPeak: Math.max(myPeak, nextCoins),
            stats,
            lastWriteAt: now,
          };
          await tx.gameProfile.update({ where: { email }, data: { state: updated } });
        } else if (rank && payout === 0) {
          const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
          const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
          const stats = ensureStats(myState);
          stats.winStreak = 0;
          const updated = { ...myState, stats, lastWriteAt: now };
          await tx.gameProfile.update({ where: { email }, data: { state: updated } });
        }

        nextState.winners = winners;

        if (state0.propsMode) {
          const eff = prevState.effects && typeof prevState.effects === "object" ? (prevState.effects as Record<string, unknown>) : {};
          const nextEff: Record<string, unknown> = { ...eff };
          if (nextEff.reverseFor === role) nextEff.reverseFor = null;
          if (nextEff.hideColorsFor === role) nextEff.hideColorsFor = null;
          nextState.effects = nextEff;
        }

        const finished = new Set<string>([...winners, ...state0.forfeits]);
        const isEnd = finished.size >= 4;
        let nextTurn = isEnd ? m.turnEmail : nextGroup4Turn([m.aEmail, m.bEmail, m.cEmail, m.dEmail], m.turnEmail, { ...state0, winners });
        if (!isEnd && state0.propsMode && state0.skipTarget) {
          const skipEmail =
            state0.skipTarget === "a" ? m.aEmail : state0.skipTarget === "b" ? m.bEmail : state0.skipTarget === "c" ? m.cEmail : m.dEmail;
          if (skipEmail && nextTurn === skipEmail) {
            nextTurn = nextGroup4Turn([m.aEmail, m.bEmail, m.cEmail, m.dEmail], skipEmail, { ...state0, winners });
            const eff = nextState.effects && typeof nextState.effects === "object" ? (nextState.effects as Record<string, unknown>) : {};
            nextState.effects = { ...eff, skipTarget: null };
          }
        }

        if (isEnd) nextState.endedReason = "group_finished";

        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "state" = ${JSON.stringify(nextState)}::jsonb, "winnerEmail" = ${
            isEnd ? winners[0] || null : m.winnerEmail
          }, "endedAt" = ${isEnd ? new Date(now) : null}, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        return { ok: true as const, solved, result, rank, payout, ended: isEnd };
      }

      if (state0.kind === "custom" && (!state0.readyA || !state0.readyB)) return { ok: false as const, error: "not_ready" as const };
      if (state0.kind === "props" && (state0.phase !== "play" || state0.pickA === null || state0.pickB === null)) return { ok: false as const, error: "not_ready" as const };
      const targetAnswer = state0.kind === "custom" ? (role === "a" ? state0.secretB : state0.secretA) : m.answer;
      if (!targetAnswer || !isDigitsN(targetAnswer, len)) return { ok: false as const, error: "not_ready" as const };

      const effectiveGuess = state0.kind === "props" && state0.reverseFor === role ? guess.split("").reverse().join("") : guess;
      const rawResult = evaluateGuess(effectiveGuess, targetAnswer);
      const solved = rawResult.every((x) => x === "ok");
      const state = state0;

      const hideColors = state0.kind === "props" && state0.hideColorsFor === role;
      const result = hideColors ? Array(len).fill("mask") : rawResult;
      const entry = { guess, result, at: now };
      const nextA = role === "a" ? (state.a as unknown[]).concat([entry]).slice(-160) : (state.a as unknown[]).slice(-160);
      const nextB = role === "b" ? (state.b as unknown[]).concat([entry]).slice(-160) : (state.b as unknown[]).slice(-160);

      const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
      const nextState: Record<string, unknown> = {
        ...prevState,
        a: nextA,
        b: nextB,
        lastMasked: { by: email, len, at: now },
      };

      const consumeEffects = () => {
        if (state0.kind !== "props") return;
        const eff = prevState.effects && typeof prevState.effects === "object" ? (prevState.effects as Record<string, unknown>) : {};
        const nextEff: Record<string, unknown> = { ...eff };
        if (nextEff.reverseFor === role) nextEff.reverseFor = null;
        if (nextEff.hideColorsFor === role) nextEff.hideColorsFor = null;
        nextState.effects = nextEff;
      };
      consumeEffects();

      if (solved && state0.kind === "props" && state0.doubleAgainst === role) {
        const newAnswer = generateAnswer(len);
        const eff = prevState.effects && typeof prevState.effects === "object" ? (prevState.effects as Record<string, unknown>) : {};
        nextState.effects = { ...eff, doubleAgainst: null };
        nextState.a = [];
        nextState.b = [];
        nextState.lastMasked = null;
        nextState.round = typeof (prevState as Record<string, unknown>).round === "number" ? Math.floor((prevState as Record<string, unknown>).round as number) + 1 : 2;

        const nextTurn = m.aEmail === email ? m.bEmail : m.aEmail;
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "answer" = ${newAnswer}, "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
        const myCoins = readCoinsFromState(myState);
        return { ok: true as const, solved: false as const, result, nextTurn: "them" as const, coins: myCoins, doubleOrNothing: true as const };
      }

      if (solved) {
        const pot = Math.max(0, Math.floor(m.fee)) * 2;
        const winnerEmail = email;
        const loserEmail = m.aEmail === winnerEmail ? m.bEmail : m.aEmail;
        nextState.endedReason = "solved";
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = ${winnerEmail}, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;

        const [winnerProfile, loserProfile] = await Promise.all([
          tx.gameProfile.findUnique({ where: { email: winnerEmail }, select: { state: true } }),
          tx.gameProfile.findUnique({ where: { email: loserEmail }, select: { state: true } }),
        ]);

        const wState = winnerProfile?.state && typeof winnerProfile.state === "object" ? (winnerProfile.state as Record<string, unknown>) : {};
        const wCoins = readCoinsFromState(wState);
        const wEarned = readCoinsEarnedTotalFromState(wState);
        const wPeak = readCoinsPeakFromState(wState);
        const wStats = ensureStats(wState);
        wStats.wins += 1;
        wStats.winsOnline += 1;
        if (m.mode === "easy") wStats.winsOnlineEasy += 1;
        else if (m.mode === "medium") wStats.winsOnlineMedium += 1;
        else if (m.mode === "hard") wStats.winsOnlineHard += 1;
        wStats.winStreak += 1;
        wStats.bestWinStreak = Math.max(wStats.bestWinStreak, wStats.winStreak);
        const wNextCoins = wCoins + pot;
        const wUpdated = {
          ...wState,
          coins: wNextCoins,
          coinsEarnedTotal: wEarned + pot,
          coinsPeak: Math.max(wPeak, wNextCoins),
          stats: wStats,
          lastWriteAt: now,
        };

        const lState = loserProfile?.state && typeof loserProfile.state === "object" ? (loserProfile.state as Record<string, unknown>) : {};
        const lStats = ensureStats(lState);
        lStats.winStreak = 0;
        const lUpdated = { ...lState, stats: lStats, lastWriteAt: now };

        await Promise.all([
          tx.gameProfile.update({ where: { email: winnerEmail }, data: { state: wUpdated } }),
          tx.gameProfile.update({ where: { email: loserEmail }, data: { state: lUpdated } }),
        ]);

        return { ok: true as const, solved: true as const, result, pot, coins: wNextCoins };
      }

      const skipTarget = state0.kind === "props" ? state0.skipTarget : null;
      const skip = skipTarget === (role === "a" ? "b" : "a");
      const nextTurn = skip ? email : m.aEmail === email ? m.bEmail : m.aEmail;
      if (skip && nextState.effects && typeof nextState.effects === "object") {
        nextState.effects = { ...(nextState.effects as Record<string, unknown>), skipTarget: null };
      }
      await tx.$executeRaw`
        UPDATE "OnlineMatch"
        SET "turnEmail" = ${nextTurn}, "turnStartedAt" = ${now}, "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
        WHERE "id" = ${matchId}
      `;

      const myProfile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const myState = myProfile?.state && typeof myProfile.state === "object" ? (myProfile.state as Record<string, unknown>) : {};
      const myCoins = readCoinsFromState(myState);

      return { ok: true as const, solved: false as const, result, nextTurn: skip ? ("me" as const) : ("them" as const), coins: myCoins, hideColors: hideColors ? (true as const) : (false as const) };
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

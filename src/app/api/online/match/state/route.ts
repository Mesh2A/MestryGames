import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const TURN_MS = 30_000;
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
  const lastMasked = s.lastMasked && typeof s.lastMasked === "object" ? (s.lastMasked as Record<string, unknown>) : null;
  const endedReason = typeof s.endedReason === "string" ? s.endedReason : null;
  const forfeitedBy = typeof s.forfeitedBy === "string" ? s.forfeitedBy : null;
  const kind = s.kind === "custom" ? ("custom" as const) : s.kind === "props" ? ("props" as const) : ("normal" as const);
  const phase =
    kind === "custom" && s.phase === "setup" ? ("setup" as const) : kind === "props" && s.phase === "cards" ? ("cards" as const) : ("play" as const);
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
  const usedA = used.a === true;
  const usedB = used.b === true;
  const skipBy = effects.skipBy === "a" || effects.skipBy === "b" ? (effects.skipBy as "a" | "b") : null;
  const reverseFor = effects.reverseFor === "a" || effects.reverseFor === "b" ? (effects.reverseFor as "a" | "b") : null;
  const hideColorsFor = effects.hideColorsFor === "a" || effects.hideColorsFor === "b" ? (effects.hideColorsFor as "a" | "b") : null;
  const doubleAgainst = effects.doubleAgainst === "a" || effects.doubleAgainst === "b" ? (effects.doubleAgainst as "a" | "b") : null;
  return {
    a,
    b,
    lastMasked,
    endedReason,
    forfeitedBy,
    kind,
    phase,
    secretA,
    secretB,
    hasSecretA,
    hasSecretB,
    readyA,
    readyB,
    deck,
    pickA,
    pickB,
    usedA,
    usedB,
    skipBy,
    reverseFor,
    hideColorsFor,
    doubleAgainst,
  };
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
      answer: string;
      turnEmail: string;
      turnStartedAt: bigint;
      winnerEmail: string | null;
      endedAt: Date | null;
      state: unknown;
    };

    const baseRows = await prisma.$queryRaw<MatchRow[]>`
      SELECT "id","mode","fee","codeLen","aEmail","bEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state"
      FROM "OnlineMatch"
      WHERE "id" = ${matchId}
      LIMIT 1
    `;
    let m = baseRows && baseRows[0] ? baseRows[0] : null;
    if (!m) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (m.aEmail !== email && m.bEmail !== email)
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });

    if (!onlineEnabled && !m.endedAt) {
      m = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email) return null;
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

    const state0 = safeState(m.state);
    const now = Date.now();
    const turnStartedAt0 = Number(m.turnStartedAt || 0);
    const needExpire = state0.phase === "play" && !m.endedAt && turnStartedAt0 > 0 && now - turnStartedAt0 >= TURN_MS;
    const needCustomStart = state0.kind === "custom" && state0.phase === "setup" && state0.readyA && state0.readyB && !m.endedAt;
    const needPropsStart = state0.kind === "props" && state0.phase === "cards" && state0.pickA !== null && state0.pickB !== null && !m.endedAt;

    if (needExpire || needCustomStart || needPropsStart) {
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email) return null;

        const stateForTurn = safeState(locked.state);
        const now2 = Date.now();
        const turnStartedAt = Number(locked.turnStartedAt || 0);
        const expired = stateForTurn.phase === "play" && !locked.endedAt && turnStartedAt > 0 && now2 - turnStartedAt >= TURN_MS;
        if (expired) {
          const nextTurn = locked.turnEmail === locked.aEmail ? locked.bEmail : locked.aEmail;
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
        if (stateAfter.kind === "props" && stateAfter.phase === "cards" && stateAfter.pickA !== null && stateAfter.pickB !== null && !locked.endedAt) {
          const now3 = Date.now();
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

        locked.state = nextStateForReturn;
        return locked;
      });
      if (updated) m = updated;
    }

    if (!m.endedAt && !m.winnerEmail) {
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<MatchRow[]>`
          SELECT "id","mode","fee","codeLen","aEmail","bEmail","answer","turnEmail","turnStartedAt","winnerEmail","endedAt","state"
          FROM "OnlineMatch"
          WHERE "id" = ${matchId}
          LIMIT 1
          FOR UPDATE
        `;
        const locked = rows && rows[0] ? rows[0] : null;
        if (!locked) return null;
        if (locked.aEmail !== email && locked.bEmail !== email) return null;
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
    const myRole = m.aEmail === email ? "a" : "b";
    const myHistory = (myRole === "a" ? state.a : state.b).filter((x) => x && typeof x === "object").slice(-120);

    const oppEmail = m.aEmail === email ? m.bEmail : m.aEmail;
    const [oppProfile, myProfile] = await Promise.all([
      prisma.gameProfile.findUnique({ where: { email: oppEmail }, select: { email: true, publicId: true, state: true, createdAt: true } }),
      prisma.gameProfile.findUnique({ where: { email }, select: { state: true, publicId: true } }),
    ]);

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
          turn: m.endedAt ? "ended" : state.phase === "setup" || state.phase === "cards" ? "setup" : m.turnEmail === email ? "me" : "them",
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

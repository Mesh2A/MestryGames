import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsEarnedTotalFromState, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { prisma } from "@/lib/prisma";
import { logOnlineEvent } from "@/lib/onlineLog";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
  const conn = await requireActiveConnection(req, email);
  if (!conn.ok) return NextResponse.json({ error: conn.error }, { status: 409, headers: { "Cache-Control": "no-store" } });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const idRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const intentRaw = body && typeof body === "object" && "intent" in body ? (body as { intent?: unknown }).intent : "";
  const matchId = String(typeof idRaw === "string" ? idRaw : "").trim();
  if (!matchId) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const intent = String(typeof intentRaw === "string" ? intentRaw : "").trim().toLowerCase();
  const isExplicitWithdraw = intent === "withdraw";

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        {
          id: string;
          mode: string;
          fee: number;
          aEmail: string;
          bEmail: string;
          cEmail: string | null;
          dEmail: string | null;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","mode","fee","aEmail","bEmail","cEmail","dEmail","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email && m.cEmail !== email && m.dEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: true as const, ended: true as const };

      const now = Date.now();
      const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
      const kind = prevState.kind === "group4" ? ("group4" as const) : prevState.kind === "custom" ? ("custom" as const) : ("normal" as const);

      if (kind === "group4") {
        const winners = Array.isArray(prevState.winners) ? prevState.winners.filter((x) => typeof x === "string") : [];
        const forfeits = Array.isArray(prevState.forfeits) ? prevState.forfeits.filter((x) => typeof x === "string") : [];
        if (!winners.includes(email) && !forfeits.includes(email)) forfeits.push(email);
        const nextState = { ...prevState, forfeits, endedReason: "forfeit", forfeitedBy: email, forfeitedAt: now };
        const finished = new Set([...winners, ...forfeits]);
        const isEnd = finished.size >= 4;
        if (isEnd) nextState.endedReason = "group_finished";
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = ${isEnd ? winners[0] || null : m.winnerEmail}, "endedAt" = ${isEnd ? new Date(now) : null}, "state" = ${JSON.stringify(
            nextState
          )}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
        const stats = ensureStats(stateObj);
        stats.winStreak = 0;
        const next = { ...stateObj, stats, lastWriteAt: now };
        await tx.gameProfile.update({ where: { email }, data: { state: next } });
        return { ok: true as const, ended: isEnd, forfeited: true as const };
      }

      if (!isExplicitWithdraw) {
        const role = m.aEmail === email ? ("a" as const) : ("b" as const);
        const { base, presence } = normalizePresenceState(m.state);
        const nextPresence =
          role === "a"
            ? { ...presence, a: { ...presence.a, disconnectedAt: now } }
            : { ...presence, b: { ...presence.b, disconnectedAt: now } };
        const nextState = { ...base, presence: nextPresence };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        return { ok: true as const, treated: "disconnect" as const };
      }

      const winnerEmail = m.aEmail === email ? m.bEmail : m.aEmail;
      const loserEmail = email;
      const phase = kind === "custom" && prevState.phase === "setup" ? ("setup" as const) : ("play" as const);
      const fee = Math.max(0, Math.floor(m.fee));
      const isSetupCancel = kind === "custom" && phase === "setup";
      const nextState = { ...prevState, endedReason: isSetupCancel ? "forfeit_setup" : "forfeit", forfeitedBy: email, forfeitedAt: now };

      if (isSetupCancel) {
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
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: now };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
          return nextCoins;
        };

        const [aCoins, bCoins] = await Promise.all([refund(m.aEmail), refund(m.bEmail)]);
        return { ok: true as const, ended: true as const, cancelled: true as const, aCoins, bCoins };
      }

      const pot = fee * 2;

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

      return { ok: true as const, ended: true as const, winner: "them" as const };
    });

    if (!out.ok) return NextResponse.json(out, { status: out.error === "forbidden" ? 403 : 404, headers: { "Cache-Control": "no-store" } });
    if (isExplicitWithdraw) logOnlineEvent({ eventType: "leave", userId: email, matchId, connectionId: conn.connectionId, status: "withdraw" });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

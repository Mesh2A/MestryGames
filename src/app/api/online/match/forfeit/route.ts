import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
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
  };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const idRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const matchId = String(typeof idRaw === "string" ? idRaw : "").trim();
  if (!matchId) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        {
          id: string;
          fee: number;
          aEmail: string;
          bEmail: string;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","fee","aEmail","bEmail","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: true as const, ended: true as const };

      const winnerEmail = m.aEmail === email ? m.bEmail : m.aEmail;
      const loserEmail = email;
      const pot = Math.max(0, Math.floor(m.fee)) * 2;
      const now = Date.now();
      const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
      const nextState = { ...prevState, endedReason: "forfeit", forfeitedBy: email, forfeitedAt: now };

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
      const wStats = ensureStats(wState);
      wStats.wins += 1;
      wStats.winsOnline += 1;
      wStats.winStreak += 1;
      wStats.bestWinStreak = Math.max(wStats.bestWinStreak, wStats.winStreak);
      const wUpdated = { ...wState, coins: wCoins + pot, stats: wStats, lastWriteAt: now };

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
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

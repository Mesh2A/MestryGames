import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
  const id = String(typeof idRaw === "string" ? idRaw : "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; email: string; status: string; fee: number }[]>`
        SELECT "id", "email", "status", "fee"
        FROM "OnlineQueue"
        WHERE "id" = ${id}
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows && rows[0] ? rows[0] : null;
      if (!row || row.email !== email) return { ok: false as const, error: "not_found" as const };
      if (row.status !== "waiting") return { ok: true as const, refunded: false as const };

      await tx.$executeRaw`
        UPDATE "OnlineQueue"
        SET "status" = 'cancelled', "updatedAt" = NOW()
        WHERE "id" = ${id}
      `;

      const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const state = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(state);
      const peakRaw = state.coinsPeak;
      const peak = typeof peakRaw === "number" && Number.isFinite(peakRaw) ? Math.max(0, Math.floor(peakRaw)) : coins;
      const nextCoins = coins + Math.max(0, Math.floor(row.fee));
      const nextState = { ...state, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins) };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
      return { ok: true as const, refunded: true as const, coins: nextCoins };
    });

    if (!out.ok) return NextResponse.json(out, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

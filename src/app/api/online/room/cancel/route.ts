import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function normalizeCode(code: string) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
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
  const conn = await requireActiveConnection(req, email);
  if (!conn.ok) return NextResponse.json({ error: conn.error }, { status: 409, headers: { "Cache-Control": "no-store" } });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const codeRaw = body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : "";
  const code = normalizeCode(typeof codeRaw === "string" ? codeRaw : "");
  if (!code) return NextResponse.json({ error: "missing_code" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { code: string; hostEmail: string; status: string; fee: number }[]
      >`SELECT "code","hostEmail","status","fee" FROM "OnlineRoom" WHERE "code" = ${code} LIMIT 1 FOR UPDATE`;
      const room = rows && rows[0] ? rows[0] : null;
      if (!room) return { ok: false as const, error: "room_not_found" as const };
      if (room.hostEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (room.status !== "waiting") return { ok: false as const, error: "cannot_cancel" as const };

      await tx.$executeRaw`UPDATE "OnlineRoom" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE "code" = ${code}`;

      const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(stateObj);
      const peak = readCoinsPeakFromState(stateObj);
      const fee = Math.max(0, Math.floor(room.fee));
      const nextCoins = coins + fee;
      const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

      return { ok: true as const, refunded: true as const, coins: nextCoins };
    });

    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.error === "forbidden" ? 403 : out.error === "room_not_found" ? 404 : 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

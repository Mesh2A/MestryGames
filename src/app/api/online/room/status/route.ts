import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
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

function parseRoomModeKey(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const };
  if (m.endsWith("_props")) return { mode: m.slice(0, -"_props".length), kind: "props" as const };
  return { mode: m, kind: "normal" as const };
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

  const code = normalizeCode(String(req.nextUrl.searchParams.get("code") || ""));
  if (!code) return NextResponse.json({ error: "missing_code" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const onlineEnabled = await getOnlineEnabled();
    if (!onlineEnabled) {
      const out = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { code: string; mode: string; fee: number; codeLen: number; hostEmail: string; guestEmail: string | null; status: string; matchId: string | null }[]
        >`SELECT "code","mode","fee","codeLen","hostEmail","guestEmail","status","matchId" FROM "OnlineRoom" WHERE "code" = ${code} LIMIT 1 FOR UPDATE`;
        const room = rows && rows[0] ? rows[0] : null;
        if (!room) return { ok: false as const };
        if (room.hostEmail !== email && room.guestEmail !== email) return { ok: false as const, forbidden: true as const };

        if (room.status === "waiting") {
          await tx.$executeRaw`UPDATE "OnlineRoom" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE "code" = ${code}`;
          if (room.hostEmail === email) {
            const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
            const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
            const coins = readCoinsFromState(stateObj);
            const peak = readCoinsPeakFromState(stateObj);
            const fee = Math.max(0, Math.floor(room.fee));
            const nextCoins = coins + fee;
            const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
            await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
            return { ok: true as const, status: "cancelled" as const, refunded: true as const, coins: nextCoins };
          }
          return { ok: true as const, status: "cancelled" as const };
        }

        const parsed = parseRoomModeKey(room.mode);
        return {
          ok: true as const,
          status: room.status,
          matchId: room.matchId,
          mode: parsed.mode,
          kind: parsed.kind,
          fee: room.fee,
          codeLen: room.codeLen,
        };
      });

      const forbidden = !out.ok && !!out && typeof out === "object" && "forbidden" in out && (out as { forbidden?: unknown }).forbidden === true;
      if (forbidden) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
      if (!out.ok) return NextResponse.json({ error: "room_not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const rows = await prisma.$queryRaw<
      { code: string; mode: string; fee: number; codeLen: number; hostEmail: string; guestEmail: string | null; status: string; matchId: string | null }[]
    >`SELECT "code","mode","fee","codeLen","hostEmail","guestEmail","status","matchId" FROM "OnlineRoom" WHERE "code" = ${code} LIMIT 1`;
    const room = rows && rows[0] ? rows[0] : null;
    if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (room.hostEmail !== email && room.guestEmail !== email) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const parsed = parseRoomModeKey(room.mode);
    return NextResponse.json(
      { status: room.status, matchId: room.matchId, mode: parsed.mode, kind: parsed.kind, fee: room.fee, codeLen: room.codeLen },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

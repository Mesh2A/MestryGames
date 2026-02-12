import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile } from "@/lib/gameProfile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readConnectionId, upsertConnection } from "@/lib/onlineConnection";
import { logOnlineEvent } from "@/lib/onlineLog";

const STALE_START_MS = 180_000;
const STALE_GROUP_MS = 600_000;

function safeStateKind(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return s.kind === "group4" ? ("group4" as const) : s.kind === "custom" ? ("custom" as const) : s.kind === "props" ? ("props" as const) : ("normal" as const);
}

function isStalePreStart(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const phase = typeof s.phase === "string" ? s.phase : "";
  if (phase === "play") return false;
  return phase === "setup" || phase === "cards" || phase === "waiting";
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

  try {
    await ensureGameProfile(email);
    const profile = await prisma.gameProfile.findUnique({ where: { email }, select: { publicId: true } });
    const userId = profile?.publicId || email;
    const hintId = readConnectionId(req);
    const conn = await upsertConnection(email, hintId);

    const matchRows = await prisma.$queryRaw<
      { id: string; createdAt: Date; updatedAt: Date; state: unknown; endedAt: Date | null; winnerEmail: string | null }[]
    >`
      SELECT "id","createdAt","updatedAt","state","endedAt","winnerEmail"
      FROM "OnlineMatch"
      WHERE ("aEmail" = ${email} OR "bEmail" = ${email} OR "cEmail" = ${email} OR "dEmail" = ${email})
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    let activeMatchId: string | null = null;
    if (matchRows && matchRows[0]) {
      const row = matchRows[0];
      const ended = !!row.endedAt || !!row.winnerEmail;
      const lastMs = Math.max(row.updatedAt ? row.updatedAt.getTime() : 0, row.createdAt ? row.createdAt.getTime() : 0);
      const kind = safeStateKind(row.state);
      const stale =
        !ended &&
        lastMs > 0 &&
        ((kind === "group4" && Date.now() - lastMs > STALE_GROUP_MS) || (Date.now() - lastMs > STALE_START_MS && isStalePreStart(row.state)));
      activeMatchId = !ended && !stale ? row.id : null;
    }

    const queueRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "OnlineQueue"
      WHERE "email" = ${email} AND "status" = 'waiting'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    const roomRows = await prisma.$queryRaw<{ code: string }[]>`
      SELECT "code"
      FROM "OnlineRoom"
      WHERE ("hostEmail" = ${email} OR "guestEmail" = ${email}) AND "status" = 'waiting'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    const queueId = queueRows && queueRows[0] ? String(queueRows[0].id || "") : "";
    const roomCode = roomRows && roomRows[0] ? String(roomRows[0].code || "") : "";
    const status = activeMatchId ? "in_match" : roomCode ? "in_room" : queueId ? "in_queue" : "idle";
    if (status === "in_match") logOnlineEvent({ eventType: "join", userId: email, matchId: activeMatchId, connectionId: conn.connectionId, status });

    return NextResponse.json(
      { ok: true, userId, activeMatchId, status, queueId, roomCode, connectionId: conn.connectionId, serverTime: Date.now() },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

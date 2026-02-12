import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { requireActiveConnection } from "@/lib/onlineConnection";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { registerLobbyClient, unregisterLobbyClient } from "@/lib/onlineLobby";
import { loadLobbyPlayers, parseQueueModeKey } from "@/lib/onlineLobbyData";

export async function GET(req: NextRequest) {
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

  const id = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const rows = await prisma.$queryRaw<{ id: string; email: string; status: string; mode: string }[]>`
    SELECT "id","email","status","mode"
    FROM "OnlineQueue"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  const row = rows && rows[0] ? rows[0] : null;
  if (!row || row.email !== email) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const meta = parseQueueModeKey(row.mode);
  const neededPlayers = meta.groupSize === 4 ? 4 : 2;
  const modeKey = row.mode;

  const encoder = new TextEncoder();
  let clientId = "";
  let closed = false;
  let pingId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        const data = JSON.stringify(payload);
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      clientId = registerLobbyClient(modeKey, send);

      const players = await loadLobbyPlayers(modeKey, neededPlayers);
      send("queue:update", { queueId: modeKey, players, neededPlayers, status: players.length >= neededPlayers ? "ready" : "waiting" });

      pingId = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {}
      }, 15000);
    },
    cancel() {
      closed = true;
      if (pingId) clearInterval(pingId);
      if (clientId) unregisterLobbyClient(clientId);
    },
  });

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  };

  return new NextResponse(stream, { status: 200, headers });
}

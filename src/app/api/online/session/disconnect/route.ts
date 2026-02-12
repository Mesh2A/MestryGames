import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureDbReady } from "@/lib/ensureDb";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { markConnectionDisconnected, readConnectionId } from "@/lib/onlineConnection";

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

  const connId = readConnectionId(req);
  if (!connId) return NextResponse.json({ ok: false, error: "missing_connection" }, { status: 409, headers: { "Cache-Control": "no-store" } });

  try {
    await markConnectionDisconnected(email, connId);
    return NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

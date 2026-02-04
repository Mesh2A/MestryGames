import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const id = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const rows = await prisma.$queryRaw<{ id: string; email: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number }[]>`
      SELECT "id", "email", "status", "matchId", "mode", "fee", "codeLen"
      FROM "OnlineQueue"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    const row = rows && rows[0] ? rows[0] : null;
    if (!row || row.email !== email) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ status: row.status, matchId: row.matchId, mode: row.mode, fee: row.fee, codeLen: row.codeLen }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}


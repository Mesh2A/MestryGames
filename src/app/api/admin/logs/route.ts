import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const takeRaw = String(req.nextUrl.searchParams.get("take") || "").trim();
  const take = Math.max(1, Math.min(200, Math.floor(parseInt(takeRaw || "100", 10) || 100)));
  const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<{ id: string; adminEmail: string; action: string; details: unknown; createdAt: Date }[]>`
      SELECT "id","adminEmail","action","details","createdAt"
      FROM "AdminLog"
      ORDER BY "createdAt" DESC
      LIMIT 200
    `;
    const filtered = q
      ? rows.filter((r) => {
          const s = `${r.adminEmail} ${r.action} ${JSON.stringify(r.details || {})}`.toLowerCase();
          return s.includes(q);
        })
      : rows;
    return NextResponse.json(
      { ok: true, items: filtered.slice(0, take).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

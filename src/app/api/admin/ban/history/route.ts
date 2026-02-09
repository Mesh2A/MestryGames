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

  const email = String(req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  const takeRaw = String(req.nextUrl.searchParams.get("take") || "").trim();
  const take = Math.max(1, Math.min(200, Math.floor(parseInt(takeRaw || "50", 10) || 50)));
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<
      { id: string; adminEmail: string; action: string; details: unknown; createdAt: Date }[]
    >`
      SELECT "id","adminEmail","action","details","createdAt"
      FROM "AdminLog"
      WHERE ("action" = 'ban' OR "action" = 'unban')
        AND (("details"->>'email')::text) = ${email}
      ORDER BY "createdAt" DESC
      LIMIT ${take}
    `;
    return NextResponse.json(
      {
        ok: true,
        items: rows.map((r) => ({
          id: r.id,
          adminEmail: r.adminEmail,
          action: r.action,
          details: r.details,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


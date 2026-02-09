import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  try {
    const now = Date.now();
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    const usersTotal = await prisma.gameProfile.count();

    const reportsTotalRows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS "n" FROM "PlayerReport"`;
    const reports24hRows =
      await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS "n" FROM "PlayerReport" WHERE "createdAt" >= ${since}`;
    const lastReportAtRows = await prisma.$queryRaw<{ at: Date | null }[]>`SELECT MAX("createdAt") AS "at" FROM "PlayerReport"`;

    const bansActiveRows =
      await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS "n" FROM "UserBan" WHERE "bannedUntil" > ${now}`;

    const onlineRows = await prisma.$queryRaw<{ onlineEnabled: boolean }[]>`
      SELECT "onlineEnabled"
      FROM "AppConfig"
      WHERE "id" = 'global'
      LIMIT 1
    `;

    const toInt = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0);
    const reportsTotal = toInt(reportsTotalRows && reportsTotalRows[0] ? reportsTotalRows[0].n : 0);
    const reports24h = toInt(reports24hRows && reports24hRows[0] ? reports24hRows[0].n : 0);
    const bansActive = toInt(bansActiveRows && bansActiveRows[0] ? bansActiveRows[0].n : 0);
    const lastReportAt = lastReportAtRows && lastReportAtRows[0] && lastReportAtRows[0].at ? lastReportAtRows[0].at.toISOString() : "";
    const onlineEnabled = onlineRows && onlineRows[0] ? !!onlineRows[0].onlineEnabled : true;

    return NextResponse.json(
      { ok: true, usersTotal, reportsTotal, reports24h, lastReportAt, bansActive, onlineEnabled },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

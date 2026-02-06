import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);
    const now = Date.now();
    const cutoff = now - 2 * 60 * 1000;

    const rows = await prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "GameProfile"
        WHERE (
          CASE
            WHEN ("state"->>'lastSeenAt') ~ '^[0-9]+$' THEN ("state"->>'lastSeenAt')::bigint
            ELSE 0
          END
        ) >= ${cutoff}
      `
    );
    const count = rows && rows[0] && typeof rows[0].count === "bigint" ? Number(rows[0].count) : 0;
    return NextResponse.json({ count: Math.max(0, Math.floor(count)) }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


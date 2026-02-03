import { authOptions } from "@/lib/auth";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = (req.nextUrl.searchParams.get("id") || "").trim().toUpperCase();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const target = await prisma.gameProfile.findUnique({
      where: { publicId: id },
      select: { email: true, publicId: true, state: true, createdAt: true },
    });
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (target.email !== email) {
      const [aEmail, bEmail] = sortPair(email, target.email);
      const link = await prisma.friendship.findUnique({ where: { aEmail_bEmail: { aEmail, bEmail } } });
      if (!link) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      {
        id: target.publicId,
        firstName: firstNameFromEmail(target.email),
        createdAt: target.createdAt.toISOString(),
        coins: readCoinsFromState(target.state),
        stats: getProfileStats(target.state),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


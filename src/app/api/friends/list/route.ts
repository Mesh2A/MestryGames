import { authOptions } from "@/lib/auth";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);
    const links = await prisma.friendship.findMany({
      where: { OR: [{ aEmail: email }, { bEmail: email }] },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: { aEmail: true, bEmail: true, updatedAt: true },
    });

    const friendEmails = Array.from(
      new Set(
        links.map((l) => (l.aEmail === email ? l.bEmail : l.aEmail)).filter((x) => typeof x === "string" && x.length > 2)
      )
    );

    const profiles = friendEmails.length
      ? await prisma.gameProfile.findMany({
          where: { email: { in: friendEmails } },
          select: { email: true, publicId: true, state: true, createdAt: true, updatedAt: true },
        })
      : [];

    const ensured = await Promise.all(profiles.map((p) => (p.publicId ? p : ensureGameProfile(p.email))));

    const friends = ensured
      .map((p) => ({
        id: p.publicId,
        firstName: firstNameFromEmail(p.email),
        coins: readCoinsFromState(p.state),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        stats: getProfileStats(p.state),
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    return NextResponse.json({ friends }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


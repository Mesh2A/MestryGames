import { authOptions } from "@/lib/auth";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name.split(/\s+/).filter(Boolean)[0] || name;
  return firstNameFromEmail(email);
}

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

    const cooldownMs = 24 * 60 * 60 * 1000;
    const giftRows = friendEmails.length
      ? await prisma.friendGift.findMany({
          where: { fromEmail: email, toEmail: { in: friendEmails } },
          select: { toEmail: true, lastGiftAt: true },
        })
      : [];
    const giftMap = new Map(giftRows.map((g) => [g.toEmail, g.lastGiftAt ? g.lastGiftAt.getTime() : 0]));
    const now = Date.now();

    const friends = ensured
      .map((p) => ({
        id: p.publicId,
        firstName: firstNameFromDisplayNameOrEmail(readDisplayNameFromState(p.state), p.email),
        coins: readCoinsFromState(p.state),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        stats: getProfileStats(p.state),
        giftAvailableAt: (giftMap.get(p.email) || 0) ? (giftMap.get(p.email) as number) + cooldownMs : 0,
        canGift: !(giftMap.get(p.email) || 0) || now >= ((giftMap.get(p.email) as number) + cooldownMs),
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    return NextResponse.json({ friends }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

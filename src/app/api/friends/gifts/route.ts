import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);

    const events = await prisma.friendGiftEvent.findMany({
      where: { toEmail: email },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { fromEmail: true, coins: true, createdAt: true },
    });

    const fromEmails = Array.from(new Set(events.map((e) => e.fromEmail)));
    const profiles = fromEmails.length
      ? await prisma.gameProfile.findMany({
          where: { email: { in: fromEmails } },
          select: { email: true, publicId: true },
        })
      : [];

    const ensured = await Promise.all(profiles.map((p) => (p.publicId ? p : ensureGameProfile(p.email))));
    const map = new Map(ensured.map((p) => [p.email, p.publicId || ""]));

    const gifts = events.map((e) => ({
      fromId: map.get(e.fromEmail) || "",
      fromName: firstNameFromEmail(e.fromEmail),
      coins: e.coins,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({ gifts }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name;
  return firstNameFromEmail(email);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);

    const sinceRaw = req.nextUrl.searchParams.get("since");
    const sinceMs = Math.max(0, Math.floor(parseInt(String(sinceRaw || "0"), 10) || 0));
    const since = sinceMs ? new Date(sinceMs) : null;

    const events = await prisma.friendGiftEvent.findMany({
      where: { toEmail: email, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { fromEmail: true, coins: true, createdAt: true },
    });

    const fromEmails = Array.from(new Set(events.map((e) => e.fromEmail)));
    const profiles = fromEmails.length
      ? await prisma.gameProfile.findMany({
          where: { email: { in: fromEmails } },
          select: { email: true, publicId: true, state: true },
        })
      : [];

    const ensured = await Promise.all(profiles.map((p) => (p.publicId ? p : ensureGameProfile(p.email))));
    const map = new Map(ensured.map((p) => [p.email, p.publicId || ""]));
    const nameMap = new Map(
      ensured.map((p) => [p.email, firstNameFromDisplayNameOrEmail(readDisplayNameFromState(p.state), p.email)])
    );

    const gifts = events.map((e) => ({
      fromId: map.get(e.fromEmail) || "",
      fromName: nameMap.get(e.fromEmail) || firstNameFromEmail(e.fromEmail),
      coins: e.coins,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({ gifts }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

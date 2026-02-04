import { authOptions } from "@/lib/auth";
import { ensureGameProfile, readCoinsEarnedTotalFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

function readPhotoFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).photo;
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^data:image\/(png|jpeg|webp);base64,/i.test(s) && s.length < 150000 ? s : "";
}

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
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
        firstName: readDisplayNameFromState(target.state) || firstNameFromEmail(target.email),
        createdAt: target.createdAt.toISOString(),
        photo: readPhotoFromState(target.state),
        coinsEarnedTotal: readCoinsEarnedTotalFromState(target.state),
        coinsPeak: readCoinsPeakFromState(target.state),
        stats: getProfileStats(target.state),
        level: getProfileLevel(target.state).level,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

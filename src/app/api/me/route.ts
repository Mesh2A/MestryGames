import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import { ensureGameProfile } from "@/lib/gameProfile";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function readPhotoFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).photo;
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^data:image\/(png|jpeg|webp);base64,/i.test(s) && s.length < 150000 ? s : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name;
  return firstNameFromEmail(email);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const ban = await getActiveBan(email);
    const profile = await ensureGameProfile(email);
    const displayEmail = profile.contactEmail || profile.email;
    const displayName = readDisplayNameFromState(profile.state);
    const photo = readPhotoFromState(profile.state);
    const level = getProfileLevel(profile.state);
    return NextResponse.json(
      {
        email: displayEmail,
        loginEmail: profile.email,
        contactEmail: profile.contactEmail,
        id: profile.publicId,
        displayName,
        photo,
        firstName: firstNameFromDisplayNameOrEmail(displayName, displayEmail),
        createdAt: profile.createdAt.toISOString(),
        stats: getProfileStats(profile.state),
        level: level.level,
        xp: level.xp,
        nextXp: level.nextXp,
        ban: ban ? { bannedUntilMs: ban.bannedUntilMs, reason: ban.reason } : null,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

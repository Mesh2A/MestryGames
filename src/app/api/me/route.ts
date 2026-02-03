import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { firstNameFromEmail, getProfileStats } from "@/lib/profile";
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
  if (name) return name.split(/\s+/).filter(Boolean)[0] || name;
  return firstNameFromEmail(email);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const profile = await ensureGameProfile(email);
    const displayName = readDisplayNameFromState(profile.state);
    const photo = readPhotoFromState(profile.state);
    return NextResponse.json(
      {
        email: profile.email,
        id: profile.publicId,
        displayName,
        photo,
        firstName: firstNameFromDisplayNameOrEmail(displayName, profile.email),
        createdAt: profile.createdAt.toISOString(),
        stats: getProfileStats(profile.state),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

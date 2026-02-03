import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { firstNameFromEmail, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const profile = await ensureGameProfile(email);
    return NextResponse.json(
      {
        email: profile.email,
        id: profile.publicId,
        firstName: firstNameFromEmail(profile.email),
        createdAt: profile.createdAt.toISOString(),
        stats: getProfileStats(profile.state),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


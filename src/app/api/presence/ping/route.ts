import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);
    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      const row = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const state = row?.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
      const nextState = { ...state, lastSeenAt: now };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


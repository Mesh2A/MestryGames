import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  try {
    await ensureGameProfile(email);
    await prisma.$transaction(async (tx) => {
      const row = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const state = row?.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
      const next = { ...state, discordUnlinkedAt: Date.now(), lastWriteAt: Date.now() } as Record<string, unknown>;
      if ("discordLinkedAt" in next) delete next.discordLinkedAt;
      await tx.gameProfile.update({ where: { email }, data: { state: next as Prisma.InputJsonValue } });
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

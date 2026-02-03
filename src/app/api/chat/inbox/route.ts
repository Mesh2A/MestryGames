import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function readStateObj(state: unknown) {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function readInbox(state: Record<string, unknown>) {
  const raw = state.chatInbox;
  return Array.isArray(raw) ? raw : [];
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = Math.max(0, Math.floor(parseInt(String(sinceRaw || "0"), 10) || 0));

  try {
    await ensureGameProfile(email);
    const row = await prisma.gameProfile.findUnique({ where: { email }, select: { state: true } });
    const state = readStateObj(row?.state);
    const inbox = readInbox(state);
    const messages = inbox
      .filter((m) => {
        if (!m || typeof m !== "object") return false;
        const t = (m as Record<string, unknown>).createdAt;
        return typeof t === "number" && Number.isFinite(t) && t > since;
      })
      .sort((a, b) => {
        const ta = typeof (a as Record<string, unknown>).createdAt === "number" ? ((a as Record<string, unknown>).createdAt as number) : 0;
        const tb = typeof (b as Record<string, unknown>).createdAt === "number" ? ((b as Record<string, unknown>).createdAt as number) : 0;
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    return NextResponse.json({ messages }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


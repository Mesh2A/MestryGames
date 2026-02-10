import { authOptions } from "@/lib/auth";
import { pruneChatState } from "@/lib/chatTtl";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

function readStateObj(state: unknown) {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function readThreads(state: Record<string, unknown>) {
  const raw = state.chatThreads;
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const withId = String(req.nextUrl.searchParams.get("with") || "").trim();
  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw ? Math.max(0, Math.floor(parseInt(String(sinceRaw), 10) || 0)) : 0;
  if (!withId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const other = await prisma.gameProfile.findUnique({ where: { publicId: withId }, select: { email: true } });
    if (!other?.email) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const link = await prisma.friendship.findFirst({
      where: {
        OR: [
          { aEmail: email, bEmail: other.email },
          { aEmail: other.email, bEmail: email },
        ],
      },
      select: { id: true },
    });
    if (!link) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const now = Date.now();
    const row = await prisma.gameProfile.findUnique({ where: { email }, select: { state: true } });
    const stateRaw = readStateObj(row?.state);
    const pruned = pruneChatState(stateRaw, now);
    const state = pruned.next;
    if (pruned.changed) {
      await prisma.gameProfile.update({ where: { email }, data: { state: state as Prisma.InputJsonValue } });
    }
    const threads = readThreads(state);
    const raw = threads[withId];
    const messages = Array.isArray(raw) ? raw : [];
    const filtered = since
      ? messages.filter((m) => m && typeof m === "object" && typeof (m as { createdAt?: unknown }).createdAt === "number" && (m as { createdAt: number }).createdAt > since)
      : messages;
    const sorted = filtered
      .slice()
      .sort((a, b) => {
        const ta = a && typeof a === "object" && typeof (a as { createdAt?: unknown }).createdAt === "number" ? (a as { createdAt: number }).createdAt : 0;
        const tb = b && typeof b === "object" && typeof (b as { createdAt?: unknown }).createdAt === "number" ? (b as { createdAt: number }).createdAt : 0;
        if (ta !== tb) return ta < tb ? -1 : 1;
        const ia = a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string" ? (a as { id: string }).id : "";
        const ib = b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string" ? (b as { id: string }).id : "";
        if (ia === ib) return 0;
        return ia < ib ? -1 : 1;
      });
    return NextResponse.json({ messages: sorted }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

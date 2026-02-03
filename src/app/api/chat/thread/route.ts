import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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

    const row = await prisma.gameProfile.findUnique({ where: { email }, select: { state: true } });
    const state = readStateObj(row?.state);
    const threads = readThreads(state);
    const raw = threads[withId];
    const messages = Array.isArray(raw) ? raw : [];
    return NextResponse.json({ messages }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


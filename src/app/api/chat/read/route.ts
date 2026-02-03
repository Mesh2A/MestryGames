import { authOptions } from "@/lib/auth";
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

function updateReadInThread(raw: unknown, opts: { readerId: string; otherId: string; now: number }) {
  const arr = Array.isArray(raw) ? raw : [];
  let changed = false;
  const next = arr.map((m) => {
    if (!m || typeof m !== "object") return m;
    const fromId = typeof (m as Record<string, unknown>).fromId === "string" ? ((m as Record<string, unknown>).fromId as string) : "";
    const toId = typeof (m as Record<string, unknown>).toId === "string" ? ((m as Record<string, unknown>).toId as string) : "";
    const readAt = typeof (m as Record<string, unknown>).readAt === "number" ? ((m as Record<string, unknown>).readAt as number) : 0;
    if (fromId === opts.otherId && toId === opts.readerId && (!readAt || readAt <= 0)) {
      changed = true;
      return { ...(m as Record<string, unknown>), readAt: opts.now };
    }
    return m;
  });
  return { changed, next };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const withId =
    body && typeof body === "object" && "withId" in body && typeof (body as { withId?: unknown }).withId === "string"
      ? String((body as { withId: string }).withId).trim()
      : "";
  if (!withId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureGameProfile(email);

    const other = await prisma.gameProfile.findUnique({ where: { publicId: withId }, select: { email: true, publicId: true } });
    if (!other?.email || !other.publicId) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
    await prisma.$transaction(async (tx) => {
      const meRow = await tx.gameProfile.findUnique({ where: { email }, select: { email: true, publicId: true, state: true } });
      const otherRow = await tx.gameProfile.findUnique({ where: { email: other.email }, select: { email: true, publicId: true, state: true } });
      if (!meRow?.publicId || !otherRow?.publicId) return;

      const meState = readStateObj(meRow.state);
      const otherState = readStateObj(otherRow.state);

      const meThreads = { ...readThreads(meState) };
      const otherThreads = { ...readThreads(otherState) };

      const meThread = updateReadInThread(meThreads[otherRow.publicId], { readerId: meRow.publicId, otherId: otherRow.publicId, now });
      if (meThread.changed) meThreads[otherRow.publicId] = meThread.next;

      const otherThread = updateReadInThread(otherThreads[meRow.publicId], { readerId: meRow.publicId, otherId: otherRow.publicId, now });
      if (otherThread.changed) otherThreads[meRow.publicId] = otherThread.next;

      if (meThread.changed) {
        const nextMeState = { ...meState, chatThreads: meThreads } as Prisma.InputJsonValue;
        await tx.gameProfile.update({ where: { email: meRow.email }, data: { state: nextMeState } });
      }
      if (otherThread.changed) {
        const nextOtherState = { ...otherState, chatThreads: otherThreads } as Prisma.InputJsonValue;
        await tx.gameProfile.update({ where: { email: otherRow.email }, data: { state: nextOtherState } });
      }
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


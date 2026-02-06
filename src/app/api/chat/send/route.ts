import { authOptions } from "@/lib/auth";
import { pruneChatState } from "@/lib/chatTtl";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name;
  return firstNameFromEmail(email);
}

function readStateObj(state: unknown) {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function readThreads(state: Record<string, unknown>) {
  const raw = state.chatThreads;
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

function readInbox(state: Record<string, unknown>) {
  const raw = state.chatInbox;
  return Array.isArray(raw) ? raw : [];
}

function capArray<T>(arr: T[], max: number) {
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
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

  const toId =
    body && typeof body === "object" && "toId" in body && typeof (body as { toId?: unknown }).toId === "string"
      ? String((body as { toId: string }).toId).trim()
      : "";
  const textRaw =
    body && typeof body === "object" && "text" in body && typeof (body as { text?: unknown }).text === "string"
      ? String((body as { text: string }).text)
      : "";
  const text = textRaw.replace(/\s+/g, " ").trim().slice(0, 240);
  const clientIdRaw =
    body && typeof body === "object" && "clientId" in body && typeof (body as { clientId?: unknown }).clientId === "string"
      ? String((body as { clientId: string }).clientId).trim()
      : "";
  const clientId = /^c_[a-f0-9]{32}$/i.test(clientIdRaw) ? clientIdRaw : "";

  if (!toId || !text) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureGameProfile(email);

    const toProfile = await prisma.gameProfile.findUnique({ where: { publicId: toId }, select: { email: true, publicId: true } });
    if (!toProfile?.email || !toProfile.publicId) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const link = await prisma.friendship.findFirst({
      where: {
        OR: [
          { aEmail: email, bEmail: toProfile.email },
          { aEmail: toProfile.email, bEmail: email },
        ],
      },
      select: { id: true },
    });
    if (!link) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const out = await prisma.$transaction(async (tx) => {
      const fromRow = await tx.gameProfile.findUnique({ where: { email }, select: { email: true, publicId: true, state: true } });
      const toRow = await tx.gameProfile.findUnique({ where: { email: toProfile.email }, select: { email: true, publicId: true, state: true } });
      if (!fromRow?.publicId || !toRow?.publicId) return { ok: false as const, status: 404 as const };

      const now = Date.now();
      const id = clientId || randomUUID();
      const fromStateRaw = readStateObj(fromRow.state);
      const toStateRaw = readStateObj(toRow.state);
      const fromPruned = pruneChatState(fromStateRaw, now);
      const toPruned = pruneChatState(toStateRaw, now);
      const fromState = fromPruned.next;
      const toState = toPruned.next;

      const fromName = firstNameFromDisplayNameOrEmail(readDisplayNameFromState(fromState), fromRow.email);

      const msg = { id, fromId: fromRow.publicId, toId: toRow.publicId, fromName, text, createdAt: now, deliveredAt: now, readAt: 0 };

      const fromThreads = { ...readThreads(fromState) };
      const fromThreadRaw = fromThreads[toRow.publicId];
      const fromThread = Array.isArray(fromThreadRaw) ? fromThreadRaw : [];
      fromThreads[toRow.publicId] = capArray([...fromThread, msg], 220);
      const nextFromState = { ...fromState, chatThreads: fromThreads } as Prisma.InputJsonValue;

      const toThreads = { ...readThreads(toState) };
      const toThreadRaw = toThreads[fromRow.publicId];
      const toThread = Array.isArray(toThreadRaw) ? toThreadRaw : [];
      toThreads[fromRow.publicId] = capArray([...toThread, msg], 220);

      const inbox = readInbox(toState);
      const nextInbox = capArray([...inbox, msg], 500);
      const nextToState = { ...toState, chatThreads: toThreads, chatInbox: nextInbox } as Prisma.InputJsonValue;

      await tx.gameProfile.update({ where: { email: fromRow.email }, data: { state: nextFromState } });
      await tx.gameProfile.update({ where: { email: toRow.email }, data: { state: nextToState } });

      return { ok: true as const, msg };
    });

    if (!out.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, msg: out.msg }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

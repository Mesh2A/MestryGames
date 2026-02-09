import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

function intFromUnknown(x: unknown) {
  if (typeof x === "number" && Number.isFinite(x)) return Math.floor(x);
  if (typeof x === "string") return Math.floor(parseInt(x, 10) || 0);
  return 0;
}

function readStateObj(state: unknown) {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const email =
    body && typeof body === "object" && "email" in body && typeof (body as { email?: unknown }).email === "string"
      ? String((body as { email: string }).email).trim().toLowerCase()
      : "";
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  const adminNoteRaw = body && typeof body === "object" && "adminNote" in body ? (body as { adminNote?: unknown }).adminNote : null;
  const riskRaw = body && typeof body === "object" && "riskLevel" in body ? (body as { riskLevel?: unknown }).riskLevel : null;
  const muteMsRaw = body && typeof body === "object" && "muteMs" in body ? (body as { muteMs?: unknown }).muteMs : null;

  const patch: Record<string, unknown> = {};

  if (adminNoteRaw !== null) {
    const note = typeof adminNoteRaw === "string" ? adminNoteRaw.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    patch.adminNote = note;
  }

  if (riskRaw !== null) {
    const r = typeof riskRaw === "string" ? riskRaw.trim().toLowerCase() : "";
    patch.riskLevel = r === "high" || r === "med" || r === "low" ? r : "";
  }

  if (muteMsRaw !== null) {
    const ms = Math.max(0, Math.min(30 * 24 * 60 * 60_000, intFromUnknown(muteMsRaw)));
    patch.chatMutedUntilMs = ms ? Date.now() + ms : 0;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    await ensureDbReady();
    const out = await prisma.$transaction(async (tx) => {
      const row = await tx.gameProfile.findUnique({ where: { email }, select: { email: true, publicId: true, state: true } });
      if (!row) return { ok: false as const, error: "not_found" as const };
      const s = readStateObj(row.state);
      const next = { ...s, ...patch, lastWriteAt: Date.now() } as Prisma.InputJsonValue;
      await tx.gameProfile.update({ where: { email }, data: { state: next } });
      return {
        ok: true as const,
        email: row.email,
        id: row.publicId || "",
        adminNote: String((patch.adminNote ?? s.adminNote) || ""),
        riskLevel: String((patch.riskLevel ?? s.riskLevel) || ""),
        chatMutedUntilMs: intFromUnknown((patch.chatMutedUntilMs ?? s.chatMutedUntilMs) || 0),
      };
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 404 });

    await logAdminAction(String(adminEmail), "user_meta", { email: out.email, id: out.id, patch });
    if (typeof patch.chatMutedUntilMs === "number") {
      await logAdminAction(String(adminEmail), "chat_mute", { email: out.email, id: out.id, chatMutedUntilMs: patch.chatMutedUntilMs });
    }
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


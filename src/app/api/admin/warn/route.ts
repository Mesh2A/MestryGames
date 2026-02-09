import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function intFromUnknown(x: unknown) {
  if (typeof x === "number" && Number.isFinite(x)) return Math.floor(x);
  if (typeof x === "string") return Math.floor(parseInt(x, 10) || 0);
  return 0;
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
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  const noteRaw = body && typeof body === "object" && "note" in body ? (body as { note?: unknown }).note : "";
  const note = typeof noteRaw === "string" ? noteRaw.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    await ensureDbReady();
    const out = await prisma.$transaction(async (tx) => {
      const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true, publicId: true } });
      if (!profile) return { ok: false as const, error: "not_found" as const };
      const s = profile.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
      const warningsRaw = s.warnings;
      const warnings = Math.max(0, intFromUnknown(warningsRaw));
      const nextWarnings = Math.min(999, warnings + 1);
      const nextState = { ...s, warnings: nextWarnings, lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
      return { ok: true as const, email, id: profile.publicId || "", warnings: nextWarnings };
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 404 });
    await logAdminAction(String(adminEmail), "warn", { email: out.email, id: out.id, warnings: out.warnings, note });
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


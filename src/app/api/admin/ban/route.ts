import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function safeEmail(v: unknown) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s.includes("@") ? s : s;
}

function safeId(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[a-z0-9]{2,32}$/i.test(s) ? s : "";
}

function safeInt(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") return Math.floor(parseInt(v, 10) || 0);
  return 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const email = safeEmail(req.nextUrl.searchParams.get("email") || "");
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<{ email: string; bannedUntil: bigint; reason: string | null; bannedBy: string | null }[]>`
      SELECT "email","bannedUntil","reason","bannedBy"
      FROM "UserBan"
      WHERE "email" = ${email}
      LIMIT 1
    `;
    const row = rows && rows[0] ? rows[0] : null;
    if (!row) return NextResponse.json({ ok: true, banned: false }, { status: 200 });
    const bannedUntilMs = Number(row.bannedUntil || 0);
    return NextResponse.json(
      { ok: true, banned: bannedUntilMs > Date.now(), bannedUntilMs, reason: row.reason || "", bannedBy: row.bannedBy || "" },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
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

  const email = safeEmail(body && typeof body === "object" && "email" in body ? (body as { email?: unknown }).email : "");
  const publicId = safeId(body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "");
  const durationMs = safeInt(body && typeof body === "object" && "durationMs" in body ? (body as { durationMs?: unknown }).durationMs : 0);
  const reasonRaw = body && typeof body === "object" && "reason" in body ? (body as { reason?: unknown }).reason : "";
  const reason = typeof reasonRaw === "string" ? reasonRaw.replace(/\s+/g, " ").trim().slice(0, 200) : "";

  if (!email && !publicId) return NextResponse.json({ error: "missing_target" }, { status: 400 });
  if (durationMs <= 0) return NextResponse.json({ error: "bad_duration" }, { status: 400 });

  const minMs = 5 * 60_000;
  const maxMs = 90 * 24 * 60 * 60_000;
  const clamped = Math.max(minMs, Math.min(maxMs, durationMs));

  try {
    await ensureDbReady();
    const now = Date.now();
    const bannedUntil = now + clamped;

    const resolvedEmail = email
      ? email
      : (
          await prisma.gameProfile.findUnique({
            where: { publicId },
            select: { email: true, publicId: true },
          })
        )?.email || "";

    if (!resolvedEmail) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (resolvedEmail.toLowerCase() === String(adminEmail).trim().toLowerCase()) return NextResponse.json({ error: "cannot_ban_self" }, { status: 400 });

    const resolved = await prisma.gameProfile.findUnique({ where: { email: resolvedEmail }, select: { publicId: true } });
    const pid = resolved?.publicId || publicId || null;

    await prisma.$executeRaw`
      INSERT INTO "UserBan" ("email","publicId","bannedUntil","reason","bannedBy","createdAt","updatedAt")
      VALUES (${resolvedEmail.toLowerCase()}, ${pid}, ${bannedUntil}, ${reason || null}, ${String(adminEmail).toLowerCase()}, NOW(), NOW())
      ON CONFLICT ("email") DO UPDATE SET
        "publicId" = EXCLUDED."publicId",
        "bannedUntil" = EXCLUDED."bannedUntil",
        "reason" = EXCLUDED."reason",
        "bannedBy" = EXCLUDED."bannedBy",
        "updatedAt" = NOW()
    `;

    return NextResponse.json({ ok: true, email: resolvedEmail.toLowerCase(), bannedUntilMs: bannedUntil, reason }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const email = safeEmail(req.nextUrl.searchParams.get("email") || "");
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    await ensureDbReady();
    await prisma.$executeRaw`DELETE FROM "UserBan" WHERE "email" = ${email}`;
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


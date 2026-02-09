import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

function intFromUnknown(x: unknown) {
  if (typeof x === "number" && Number.isFinite(x)) return Math.floor(x);
  if (typeof x === "string") return Math.floor(parseInt(x, 10) || 0);
  return 0;
}

function readCoinsFromState(state: unknown) {
  if (!state || typeof state !== "object") return 0;
  const coinsRaw = (state as Record<string, unknown>).coins;
  const coins = intFromUnknown(coinsRaw);
  return Math.max(0, coins);
}

function firstNameFromEmail(email: string) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[^a-zA-Z0-9_ .-]+/g, " ").trim();
  const token = cleaned.split(/[\s._-]+/g).filter(Boolean)[0] || local;
  return token.slice(0, 1).toUpperCase() + token.slice(1);
}

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function readPhotoFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).photo;
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^data:image\/(png|jpeg|webp);base64,/i.test(s) && s.length < 150000 ? s : "";
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const takeRaw = req.nextUrl.searchParams.get("take");
  const take = Math.max(1, Math.min(200, intFromUnknown(takeRaw)));

  try {
    await ensureDbReady();
    const rows = await prisma.gameProfile.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { updatedAt: "desc" },
      take,
      select: { email: true, publicId: true, createdAt: true, updatedAt: true, state: true },
    });

    const ids = rows.map((r) => r.publicId).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    const emails = rows.map((r) => r.email).filter((x): x is string => typeof x === "string" && x.trim().length > 0);

    const reports = ids.length
      ? await prisma.$queryRaw<{ targetId: string; n: bigint }[]>`
          SELECT "targetId", COUNT(*) AS "n"
          FROM "PlayerReport"
          WHERE "targetId" IN (${Prisma.join(ids)})
          GROUP BY "targetId"
        `
      : [];
    const reportMap = new Map(reports.map((r) => [String(r.targetId), Number(r.n || 0)]));

    const bans = emails.length
      ? await prisma.$queryRaw<{ email: string; bannedUntil: bigint; reason: string | null }[]>`
          SELECT "email","bannedUntil","reason"
          FROM "UserBan"
          WHERE "email" IN (${Prisma.join(emails)})
        `
      : [];
    const banMap = new Map(bans.map((b) => [String(b.email).toLowerCase(), { until: Number(b.bannedUntil || 0), reason: b.reason || "" }]));
    const now = Date.now();

    const users = rows.map((r) => {
      const displayName = readDisplayNameFromState(r.state);
      const firstName = displayName || firstNameFromEmail(r.email);
      const ban = banMap.get(String(r.email).toLowerCase());
      const bannedUntilMs = ban && Number.isFinite(ban.until) ? Math.max(0, Math.floor(ban.until)) : 0;
      return {
        email: r.email,
        id: r.publicId || "",
        displayName,
        firstName,
        photo: readPhotoFromState(r.state),
        coins: readCoinsFromState(r.state),
        stats: getProfileStats(r.state),
        reportsReceived: r.publicId ? reportMap.get(r.publicId) || 0 : 0,
        bannedUntilMs,
        banReason: ban ? String(ban.reason || "") : "",
        banned: !!(bannedUntilMs && bannedUntilMs > now),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ users }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });
  if (email === String(adminEmail || "").trim().toLowerCase()) return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });

  try {
    await prisma.gameProfile.delete({ where: { email } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "P2025") return NextResponse.json({ ok: true, missing: true }, { status: 200 });
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

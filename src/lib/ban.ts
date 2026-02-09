import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";

export type ActiveBan = {
  email: string;
  bannedUntilMs: number;
  reason: string;
  bannedBy: string;
};

function safeStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeMs(v: unknown) {
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.max(0, n);
}

export async function getActiveBan(emailRaw: string): Promise<ActiveBan | null> {
  const email = safeStr(emailRaw).toLowerCase();
  if (!email) return null;
  try {
    await ensureDbReady();
  } catch {
    return null;
  }

  const rows = await prisma.$queryRaw<{ email: string; bannedUntil: bigint; reason: string | null; bannedBy: string | null }[]>`
    SELECT "email","bannedUntil","reason","bannedBy"
    FROM "UserBan"
    WHERE "email" = ${email}
    LIMIT 1
  `;
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return null;

  const bannedUntilMs = safeMs(row.bannedUntil);
  const now = Date.now();
  if (!bannedUntilMs || bannedUntilMs <= now) {
    await prisma.$executeRaw`DELETE FROM "UserBan" WHERE "email" = ${email}`;
    return null;
  }

  return {
    email,
    bannedUntilMs,
    reason: safeStr(row.reason),
    bannedBy: safeStr(row.bannedBy),
  };
}


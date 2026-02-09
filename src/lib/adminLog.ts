import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export async function logAdminAction(adminEmailRaw: string, action: string, details: Record<string, unknown>) {
  const adminEmail = String(adminEmailRaw || "").trim().toLowerCase();
  const a = String(action || "").trim();
  if (!adminEmail || !a) return;
  try {
    await ensureDbReady();
  } catch {
    return;
  }
  const id = `al_${randomUUID()}`;
  const payload = details && typeof details === "object" ? details : {};
  try {
    await prisma.$executeRaw`
      INSERT INTO "AdminLog" ("id","adminEmail","action","details","createdAt")
      VALUES (${id}, ${adminEmail}, ${a}, ${JSON.stringify(payload)}::jsonb, NOW())
    `;
  } catch {}
}


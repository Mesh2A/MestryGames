import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";

export async function getOnlineEnabled() {
  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<{ onlineEnabled: boolean }[]>`
      SELECT "onlineEnabled" FROM "AppConfig" WHERE "id" = 'global' LIMIT 1
    `;
    const v = rows && rows[0] ? rows[0].onlineEnabled : true;
    return typeof v === "boolean" ? v : true;
  } catch {
    return true;
  }
}

export async function setOnlineEnabled(enabled: boolean) {
  await ensureDbReady();
  await prisma.$executeRaw`
    UPDATE "AppConfig" SET "onlineEnabled" = ${enabled}, "updatedAt" = NOW() WHERE "id" = 'global'
  `;
}


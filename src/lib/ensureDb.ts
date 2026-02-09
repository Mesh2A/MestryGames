import { prisma } from "@/lib/prisma";

type EnsureState = {
  ensured?: boolean;
  ensuring?: Promise<void> | null;
};

const globalForEnsure = globalThis as unknown as EnsureState;

export async function ensureDbReady() {
  if (globalForEnsure.ensured) return;
  if (!globalForEnsure.ensuring) {
    globalForEnsure.ensuring = (async () => {
      const attempts = process.env.NODE_ENV === "production" ? 3 : 1;
      let lastError: unknown = null;
      for (let i = 0; i < attempts; i++) {
        try {
          await prisma.$executeRawUnsafe('ALTER TABLE "GameProfile" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT');
          await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "GameProfile_contactEmail_key" ON "GameProfile"("contactEmail")');
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "OnlineQueue" (
              "id" TEXT PRIMARY KEY,
              "email" TEXT NOT NULL,
              "mode" TEXT NOT NULL,
              "fee" INTEGER NOT NULL,
              "codeLen" INTEGER NOT NULL,
              "status" TEXT NOT NULL,
              "matchId" TEXT,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "OnlineQueue_waiting_email_key"
            ON "OnlineQueue"("email")
            WHERE "status" = 'waiting'
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "OnlineQueue_mode_status_createdAt_idx"
            ON "OnlineQueue"("mode", "status", "createdAt")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "OnlineMatch" (
              "id" TEXT PRIMARY KEY,
              "mode" TEXT NOT NULL,
              "fee" INTEGER NOT NULL,
              "codeLen" INTEGER NOT NULL,
              "aEmail" TEXT NOT NULL,
              "bEmail" TEXT NOT NULL,
              "answer" TEXT NOT NULL,
              "turnEmail" TEXT NOT NULL,
              "turnStartedAt" BIGINT NOT NULL,
              "winnerEmail" TEXT,
              "endedAt" TIMESTAMPTZ,
              "state" JSONB NOT NULL DEFAULT '{}'::jsonb,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "OnlineMatch_aEmail_createdAt_idx"
            ON "OnlineMatch"("aEmail", "createdAt")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "OnlineMatch_bEmail_createdAt_idx"
            ON "OnlineMatch"("bEmail", "createdAt")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "OnlineRoom" (
              "code" TEXT PRIMARY KEY,
              "mode" TEXT NOT NULL,
              "fee" INTEGER NOT NULL,
              "codeLen" INTEGER NOT NULL,
              "hostEmail" TEXT NOT NULL,
              "guestEmail" TEXT,
              "status" TEXT NOT NULL,
              "matchId" TEXT,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "OnlineRoom_waiting_hostEmail_key"
            ON "OnlineRoom"("hostEmail")
            WHERE "status" = 'waiting'
          `);
          await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "OnlineRoom_waiting_guestEmail_key"
            ON "OnlineRoom"("guestEmail")
            WHERE "status" = 'waiting' AND "guestEmail" IS NOT NULL
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "OnlineRoom_status_createdAt_idx"
            ON "OnlineRoom"("status", "createdAt")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "AppConfig" (
              "id" TEXT PRIMARY KEY,
              "onlineEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
              "turnMs" INTEGER NOT NULL DEFAULT 30000,
              "reportAlertThreshold" INTEGER NOT NULL DEFAULT 5,
              "maintenanceMode" BOOLEAN NOT NULL DEFAULT FALSE,
              "profanityFilterEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`INSERT INTO "AppConfig" ("id") VALUES ('global') ON CONFLICT ("id") DO NOTHING`);
          await prisma.$executeRawUnsafe('ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "turnMs" INTEGER NOT NULL DEFAULT 30000');
          await prisma.$executeRawUnsafe('ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "reportAlertThreshold" INTEGER NOT NULL DEFAULT 5');
          await prisma.$executeRawUnsafe('ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "maintenanceMode" BOOLEAN NOT NULL DEFAULT FALSE');
          await prisma.$executeRawUnsafe('ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "profanityFilterEnabled" BOOLEAN NOT NULL DEFAULT FALSE');
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "PlayerReport" (
              "id" TEXT PRIMARY KEY,
              "reporterEmail" TEXT NOT NULL,
              "reporterId" TEXT,
              "targetId" TEXT NOT NULL,
              "reason" TEXT,
              "details" TEXT,
              "status" TEXT NOT NULL DEFAULT 'new',
              "matchId" TEXT,
              "chatId" TEXT,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "PlayerReport_targetId_createdAt_idx"
            ON "PlayerReport"("targetId", "createdAt")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "PlayerReport_reporterEmail_createdAt_idx"
            ON "PlayerReport"("reporterEmail", "createdAt")
          `);
          await prisma.$executeRawUnsafe('ALTER TABLE "PlayerReport" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT \'new\'');
          await prisma.$executeRawUnsafe('ALTER TABLE "PlayerReport" ADD COLUMN IF NOT EXISTS "matchId" TEXT');
          await prisma.$executeRawUnsafe('ALTER TABLE "PlayerReport" ADD COLUMN IF NOT EXISTS "chatId" TEXT');
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UserBan" (
              "email" TEXT PRIMARY KEY,
              "publicId" TEXT,
              "bannedUntil" BIGINT NOT NULL,
              "reason" TEXT,
              "bannedBy" TEXT,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "UserBan_bannedUntil_idx"
            ON "UserBan"("bannedUntil")
          `);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "AdminLog" (
              "id" TEXT PRIMARY KEY,
              "adminEmail" TEXT NOT NULL,
              "action" TEXT NOT NULL,
              "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "AdminLog_createdAt_idx"
            ON "AdminLog"("createdAt")
          `);
          globalForEnsure.ensured = true;
          return;
        } catch (e) {
          lastError = e;
          if (i === attempts - 1) throw e;
          const waitMs = 350 * (i + 1);
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
      if (lastError) throw lastError;
    })().finally(() => {
      globalForEnsure.ensuring = null;
    });
  }
  await globalForEnsure.ensuring;
}

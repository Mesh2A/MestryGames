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

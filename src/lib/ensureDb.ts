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

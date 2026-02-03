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
      await prisma.$executeRawUnsafe('ALTER TABLE "GameProfile" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT');
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "GameProfile_contactEmail_key" ON "GameProfile"("contactEmail")');
      globalForEnsure.ensured = true;
    })().finally(() => {
      globalForEnsure.ensuring = null;
    });
  }
  await globalForEnsure.ensuring;
}

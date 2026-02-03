import { prisma } from "@/lib/prisma";
import { generatePublicId } from "@/lib/profile";

export function readCoinsFromState(state: unknown) {
  if (!state || typeof state !== "object") return 0;
  const coinsRaw = (state as Record<string, unknown>).coins;
  const coins =
    typeof coinsRaw === "number" && Number.isFinite(coinsRaw)
      ? Math.floor(coinsRaw)
      : typeof coinsRaw === "string"
        ? Math.floor(parseInt(coinsRaw, 10) || 0)
        : 0;
  return Math.max(0, coins);
}

export async function ensureGameProfile(email: string) {
  return prisma.$transaction(async (tx) => {
    let existing = await tx.gameProfile.findUnique({ where: { email } });
    if (existing && existing.publicId) return existing;

    for (let attempt = 0; attempt < 7; attempt++) {
      const publicId = generatePublicId(8);
      try {
        if (!existing) {
          return await tx.gameProfile.create({
            data: { email, publicId, state: {} },
          });
        }

        return await tx.gameProfile.update({
          where: { email },
          data: { publicId },
        });
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (code === "P2002") {
          existing = await tx.gameProfile.findUnique({ where: { email } });
          if (existing?.publicId) return existing;
          continue;
        }
        throw e;
      }
    }

    throw new Error("public_id_unavailable");
  });
}

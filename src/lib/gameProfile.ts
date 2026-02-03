import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
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
    const admin = isAdminEmail(email);
    let existing = await tx.gameProfile.findUnique({ where: { email } });
    if (existing?.publicId && (!admin || existing.publicId === "M1")) return existing;

    for (let attempt = 0; attempt < 7; attempt++) {
      const publicId = admin ? "M1" : generatePublicId(11);
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
          if (admin) {
            const owner = await tx.gameProfile.findUnique({ where: { publicId: "M1" } });
            if (owner?.email === email) return owner;
            if (owner) {
              await tx.gameProfile.update({
                where: { email: owner.email },
                data: { publicId: generatePublicId(11) },
              });
            }
            continue;
          }
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

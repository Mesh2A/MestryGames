import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel } from "@/lib/profile";
import { readCoinsFromState } from "@/lib/gameProfile";

export type LobbyPlayer = {
  userId: string;
  name: string;
  avatarUrl: string;
  coins: number;
  level: number;
};

export function parseQueueModeKey(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_g4_props")) return { mode: m.slice(0, -"_g4_props".length), kind: "props" as const, groupSize: 4 as const };
  if (m.endsWith("_g4")) return { mode: m.slice(0, -"_g4".length), kind: "normal" as const, groupSize: 4 as const };
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const, groupSize: 2 as const };
  if (m.endsWith("_props")) return { mode: m.slice(0, -"_props".length), kind: "props" as const, groupSize: 2 as const };
  return { mode: m, kind: "normal" as const, groupSize: 2 as const };
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

export async function loadLobbyPlayers(modeKey: string, limit: number): Promise<LobbyPlayer[]> {
  const rows = await prisma.$queryRaw<{ email: string }[]>`
    SELECT "email"
    FROM "OnlineQueue"
    WHERE "mode" = ${modeKey} AND "status" = 'waiting'
    ORDER BY "createdAt" ASC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `;
  const emails = rows.map((r) => r.email).filter(Boolean);
  if (!emails.length) return [];
  const profiles = await prisma.gameProfile.findMany({
    where: { email: { in: emails } },
    select: { email: true, publicId: true, state: true },
  });
  const map = new Map<string, { publicId: string; state: unknown }>();
  for (const p of profiles) map.set(p.email, { publicId: p.publicId || p.email, state: p.state });
  return emails.map((email) => {
    const row = map.get(email);
    const state = row?.state;
    const displayName = readDisplayNameFromState(state);
    const level = getProfileLevel(state).level;
    return {
      userId: row?.publicId || email,
      name: displayName || firstNameFromEmail(email),
      avatarUrl: readPhotoFromState(state),
      coins: readCoinsFromState(state),
      level,
    };
  });
}

export async function loadPlayersByEmails(emails: string[]): Promise<LobbyPlayer[]> {
  const list = emails.filter(Boolean);
  if (!list.length) return [];
  const profiles = await prisma.gameProfile.findMany({
    where: { email: { in: list } },
    select: { email: true, publicId: true, state: true },
  });
  const map = new Map<string, { publicId: string; state: unknown }>();
  for (const p of profiles) map.set(p.email, { publicId: p.publicId || p.email, state: p.state });
  return list.map((email) => {
    const row = map.get(email);
    const state = row?.state;
    const displayName = readDisplayNameFromState(state);
    const level = getProfileLevel(state).level;
    return {
      userId: row?.publicId || email,
      name: displayName || firstNameFromEmail(email),
      avatarUrl: readPhotoFromState(state),
      coins: readCoinsFromState(state),
      level,
    };
  });
}

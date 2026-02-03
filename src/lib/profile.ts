import { randomBytes } from "crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function firstNameFromEmail(email: string) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[^a-zA-Z0-9_ .-]+/g, " ").trim();
  const token = cleaned.split(/[\s._-]+/g).filter(Boolean)[0] || local;
  return token.slice(0, 1).toUpperCase() + token.slice(1);
}

export function generatePublicId(length = 11) {
  const bytes = randomBytes(Math.max(16, length));
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function getProfileStats(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const stats = s.stats && typeof s.stats === "object" ? (s.stats as Record<string, unknown>) : {};

  const streakRaw = stats.streakNoHint;
  const streak = typeof streakRaw === "number" && Number.isFinite(streakRaw) ? Math.max(0, Math.floor(streakRaw)) : 0;

  const winsRaw = stats.wins;
  const wins = typeof winsRaw === "number" && Number.isFinite(winsRaw) ? Math.max(0, Math.floor(winsRaw)) : 0;

  const unlockedRaw = s.unlocked;
  const unlocked = typeof unlockedRaw === "number" && Number.isFinite(unlockedRaw) ? Math.max(1, Math.floor(unlockedRaw)) : 1;

  const completedRaw = s.completed;
  const completed = Array.isArray(completedRaw) ? completedRaw.filter((n) => Number.isInteger(n)).length : 0;

  return { streak, wins, unlocked, completed };
}

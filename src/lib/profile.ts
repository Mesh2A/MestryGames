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

  const winStreakRaw = stats.winStreak;
  const winStreak = typeof winStreakRaw === "number" && Number.isFinite(winStreakRaw) ? Math.max(0, Math.floor(winStreakRaw)) : 0;

  const bestWinStreakRaw = stats.bestWinStreak;
  const bestWinStreak =
    typeof bestWinStreakRaw === "number" && Number.isFinite(bestWinStreakRaw) ? Math.max(0, Math.floor(bestWinStreakRaw)) : 0;

  const winsNormalRaw = stats.winsNormal;
  const winsNormal = typeof winsNormalRaw === "number" && Number.isFinite(winsNormalRaw) ? Math.max(0, Math.floor(winsNormalRaw)) : 0;

  const winsTimedRaw = stats.winsTimed;
  const winsTimed = typeof winsTimedRaw === "number" && Number.isFinite(winsTimedRaw) ? Math.max(0, Math.floor(winsTimedRaw)) : 0;

  const winsLimitedRaw = stats.winsLimited;
  const winsLimited =
    typeof winsLimitedRaw === "number" && Number.isFinite(winsLimitedRaw) ? Math.max(0, Math.floor(winsLimitedRaw)) : 0;

  const winsDailyRaw = stats.winsDaily;
  const winsDaily = typeof winsDailyRaw === "number" && Number.isFinite(winsDailyRaw) ? Math.max(0, Math.floor(winsDailyRaw)) : 0;

  const winsOnlineRaw = stats.winsOnline;
  const winsOnline = typeof winsOnlineRaw === "number" && Number.isFinite(winsOnlineRaw) ? Math.max(0, Math.floor(winsOnlineRaw)) : 0;

  const unlockedRaw = s.unlocked;
  const unlocked = typeof unlockedRaw === "number" && Number.isFinite(unlockedRaw) ? Math.max(1, Math.floor(unlockedRaw)) : 1;

  const completedRaw = s.completed;
  const completed = Array.isArray(completedRaw) ? completedRaw.filter((n) => Number.isInteger(n)).length : 0;

  return { streak, wins, winStreak, bestWinStreak, winsNormal, winsTimed, winsLimited, winsDaily, winsOnline, unlocked, completed };
}

export function getProfileLevel(state: unknown) {
  const stats = getProfileStats(state);
  const xp = Math.max(
    0,
    Math.floor(stats.completed * 12 + stats.wins * 8 + stats.streak * 6 + Math.floor(stats.unlocked / 10) * 5)
  );
  let level = 1;
  for (let next = 2; next <= 99; next++) {
    const need = 120 * next * next + 180 * next;
    if (xp >= need) level = next;
    else break;
  }
  const nextNeed = level >= 99 ? null : 120 * (level + 1) * (level + 1) + 180 * (level + 1);
  return { level, xp, nextXp: nextNeed };
}

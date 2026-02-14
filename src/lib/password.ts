import { scryptSync, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

export function hashPassword(password: string) {
  const pwd = String(password || "");
  const hash = bcrypt.hashSync(pwd, 12);
  return `bcrypt:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const s = String(stored || "");
  if (s.startsWith("bcrypt:")) {
    const hash = s.slice("bcrypt:".length);
    return bcrypt.compareSync(String(password || ""), hash);
  }
  const [alg, saltHex, hashHex] = s.split(":");
  if (alg !== "scrypt") return false;
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (!salt.length || !expected.length) return false;
  const actual = scryptSync(String(password || ""), salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

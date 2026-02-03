import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function sqliteFileFromDatabaseUrl(url: string) {
  const u = String(url || "").trim();
  if (!u) return "./dev.db";
  if (u === ":memory:" || u === "file::memory:") return ":memory:";
  if (u.startsWith("file:")) return u.slice("file:".length);
  return u;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: sqliteFileFromDatabaseUrl(process.env.DATABASE_URL || "file:./dev.db") }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

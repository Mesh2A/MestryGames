import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pool?: Pool };

const fallbackDatabaseUrl = "postgresql://user:pass@localhost:5432/db?schema=public";
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_DATABASE_URL ||
  process.env.POSTGRES_URL_POSTGRES_URL ||
  fallbackDatabaseUrl;

const pool = globalForPrisma.pool ?? new Pool({ connectionString: databaseUrl });
if (process.env.NODE_ENV !== "production") globalForPrisma.pool = pool;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

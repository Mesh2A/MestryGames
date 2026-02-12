import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { logOnlineEvent } from "@/lib/onlineLog";

const RECONNECT_WINDOW_MS = 60_000;

function toNum(v: unknown) {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  return 0;
}

export function readConnectionId(req: NextRequest) {
  const raw = req.headers.get("x-conn-id");
  const id = String(raw || "").trim();
  if (id) return id;
  const qp = req.nextUrl?.searchParams?.get("conn") || "";
  return String(qp || "").trim();
}

export function newConnectionId() {
  return `c_${randomBytes(16).toString("hex")}`;
}

export async function upsertConnection(email: string, hintId: string) {
  const now = Date.now();
  const nextId = newConnectionId();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { userId: string; connectionId: string; status: string; lastSeenAt: bigint | number; disconnectedAt: bigint | number; cleanupAt: bigint | number }[]
    >`SELECT "userId","connectionId","status","lastSeenAt","disconnectedAt","cleanupAt" FROM "OnlineConnection" WHERE "userId" = ${email} LIMIT 1 FOR UPDATE`;
    const row = rows && rows[0] ? rows[0] : null;
    if (!row) {
      await tx.$executeRaw`
        INSERT INTO "OnlineConnection" ("userId","connectionId","status","lastSeenAt","disconnectedAt","cleanupAt","supersededAt","createdAt","updatedAt")
        VALUES (${email}, ${nextId}, 'active', ${now}, 0, 0, 0, NOW(), NOW())
      `;
      logOnlineEvent({ eventType: "connect", userId: email, connectionId: nextId, status: "active" });
      return { connectionId: nextId, status: "active" as const, eventType: "connect" as const };
    }

    const rowConn = String(row.connectionId || "");
    const disconnectedAt = toNum(row.disconnectedAt);
    const cleanupAt = toNum(row.cleanupAt);
    const same = !!hintId && hintId === rowConn;

    if (row.status === "disconnected" && disconnectedAt > 0 && now - disconnectedAt <= RECONNECT_WINDOW_MS && same) {
      await tx.$executeRaw`
        UPDATE "OnlineConnection"
        SET "status" = 'active', "lastSeenAt" = ${now}, "disconnectedAt" = 0, "updatedAt" = NOW()
        WHERE "userId" = ${email}
      `;
      logOnlineEvent({ eventType: "reconnect", userId: email, connectionId: rowConn, status: "active" });
      return { connectionId: rowConn, status: "active" as const, eventType: "reconnect" as const };
    }

    if (row.status === "disconnected" && disconnectedAt > 0 && now - disconnectedAt > RECONNECT_WINDOW_MS && cleanupAt === 0) {
      await tx.$executeRaw`
        UPDATE "OnlineConnection"
        SET "status" = 'expired', "cleanupAt" = ${now}, "updatedAt" = NOW()
        WHERE "userId" = ${email}
      `;
      logOnlineEvent({ eventType: "timeout", userId: email, connectionId: rowConn, status: "expired" });
    }

    const finalId = same ? rowConn : nextId;
    const eventType = same ? "connect" : "supersede";
    await tx.$executeRaw`
      UPDATE "OnlineConnection"
      SET "connectionId" = ${finalId}, "status" = 'active', "lastSeenAt" = ${now}, "disconnectedAt" = 0, "supersededAt" = ${same ? 0 : now}, "updatedAt" = NOW()
      WHERE "userId" = ${email}
    `;
    logOnlineEvent({ eventType, userId: email, connectionId: finalId, status: "active" });
    return { connectionId: finalId, status: "active" as const, eventType: eventType as "connect" | "supersede" };
  });
}

export async function requireActiveConnection(req: NextRequest, email: string) {
  const connId = readConnectionId(req);
  if (!connId) return { ok: false as const, error: "missing_connection" as const };
  const rows = await prisma.$queryRaw<
    { connectionId: string; status: string; lastSeenAt: bigint | number; disconnectedAt: bigint | number; cleanupAt: bigint | number }[]
  >`SELECT "connectionId","status","lastSeenAt","disconnectedAt","cleanupAt" FROM "OnlineConnection" WHERE "userId" = ${email} LIMIT 1`;
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return { ok: false as const, error: "connection_not_found" as const };
  if (String(row.connectionId || "") !== connId) return { ok: false as const, error: "connection_superseded" as const };
  const now = Date.now();
  const disconnectedAt = toNum(row.disconnectedAt);
  if (row.status === "disconnected" && disconnectedAt > 0 && now - disconnectedAt > RECONNECT_WINDOW_MS) {
    const cleanupAt = toNum(row.cleanupAt);
    if (!cleanupAt) {
      await prisma.$executeRaw`
        UPDATE "OnlineConnection"
        SET "status" = 'expired', "cleanupAt" = ${now}, "updatedAt" = NOW()
        WHERE "userId" = ${email} AND "connectionId" = ${connId}
      `;
      logOnlineEvent({ eventType: "timeout", userId: email, connectionId: connId, status: "expired" });
    }
    return { ok: false as const, error: "connection_expired" as const };
  }

  await prisma.$executeRaw`
    UPDATE "OnlineConnection"
    SET "status" = 'active', "lastSeenAt" = ${now}, "disconnectedAt" = 0, "updatedAt" = NOW()
    WHERE "userId" = ${email} AND "connectionId" = ${connId}
  `;
  return { ok: true as const, connectionId: connId };
}

export async function markConnectionDisconnected(email: string, connId: string) {
  if (!connId) return { ok: false as const };
  const now = Date.now();
  await prisma.$executeRaw`
    UPDATE "OnlineConnection"
    SET "status" = 'disconnected', "disconnectedAt" = ${now}, "updatedAt" = NOW()
    WHERE "userId" = ${email} AND "connectionId" = ${connId}
  `;
  logOnlineEvent({ eventType: "disconnect", userId: email, connectionId: connId, status: "disconnected" });
  return { ok: true as const };
}

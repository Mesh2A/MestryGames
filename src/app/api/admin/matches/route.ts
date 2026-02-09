import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function normalizeStateForEnd(raw: unknown) {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(base.a) ? base.a : [];
  const b = Array.isArray(base.b) ? base.b : [];
  const lastMasked = base.lastMasked && typeof base.lastMasked === "object" ? base.lastMasked : null;
  return { ...base, a, b, lastMasked, endedReason: "admin", forfeitedBy: null };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const takeRaw = String(req.nextUrl.searchParams.get("take") || "").trim();
  const take = Math.max(1, Math.min(200, Math.floor(parseInt(takeRaw || "50", 10) || 50)));

  try {
    await ensureDbReady();

    const queueWaitingRows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS "n" FROM "OnlineQueue" WHERE "status" = 'waiting'`;
    const roomWaitingRows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS "n" FROM "OnlineRoom" WHERE "status" = 'waiting'`;
    const matchOngoingRows = await prisma.$queryRaw<
      { id: string; mode: string; fee: number; codeLen: number; aEmail: string; bEmail: string; createdAt: Date; updatedAt: Date }[]
    >`
      SELECT "id","mode","fee","codeLen","aEmail","bEmail","createdAt","updatedAt"
      FROM "OnlineMatch"
      WHERE "endedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 200
    `;
    const matchEndedRows = await prisma.$queryRaw<
      { id: string; mode: string; fee: number; codeLen: number; aEmail: string; bEmail: string; winnerEmail: string | null; endedAt: Date | null; createdAt: Date }[]
    >`
      SELECT "id","mode","fee","codeLen","aEmail","bEmail","winnerEmail","endedAt","createdAt"
      FROM "OnlineMatch"
      WHERE "endedAt" IS NOT NULL
      ORDER BY "endedAt" DESC
      LIMIT 50
    `;

    const toInt = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0);
    const queueWaiting = toInt(queueWaitingRows && queueWaitingRows[0] ? queueWaitingRows[0].n : 0);
    const roomWaiting = toInt(roomWaitingRows && roomWaitingRows[0] ? roomWaitingRows[0].n : 0);

    return NextResponse.json(
      {
        ok: true,
        queueWaiting,
        roomWaiting,
        ongoing: matchOngoingRows.slice(0, take).map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
        recentEnded: matchEndedRows.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          endedAt: m.endedAt ? m.endedAt.toISOString() : null,
        })),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const action = body && typeof body === "object" && "action" in body ? String((body as { action?: unknown }).action || "").trim() : "";
  const matchId = body && typeof body === "object" && "matchId" in body ? String((body as { matchId?: unknown }).matchId || "").trim() : "";
  const reasonRaw = body && typeof body === "object" && "reason" in body ? (body as { reason?: unknown }).reason : "";
  const reason = typeof reasonRaw === "string" ? reasonRaw.replace(/\s+/g, " ").trim().slice(0, 160) : "";

  if (action !== "end" || !matchId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureDbReady();
    const out = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; state: unknown; endedAt: Date | null }[]>`
        SELECT "id","state","endedAt"
        FROM "OnlineMatch"
        WHERE "id" = ${matchId}
        LIMIT 1
        FOR UPDATE
      `;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.endedAt) return { ok: true as const, alreadyEnded: true };
      const nextState = normalizeStateForEnd(m.state);
      await tx.$executeRaw`
        UPDATE "OnlineMatch"
        SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
        WHERE "id" = ${matchId}
      `;
      return { ok: true as const, ended: true };
    });

    await logAdminAction(String(adminEmail), "match_end", { matchId, reason });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 404 });
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


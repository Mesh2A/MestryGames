import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function safeObj(raw: unknown) {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizePresenceState(state: unknown) {
  const base = safeObj(state);
  const presence = safeObj(base.presence);
  const a = safeObj(presence.a);
  const b = safeObj(presence.b);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const normSide = (side: Record<string, unknown>) => ({
    lastSeenAt: num(side.lastSeenAt),
    disconnectedAt: num(side.disconnectedAt),
  });
  return { base, presence: { a: normSide(a), b: normSide(b) } };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const idRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const matchId = String(typeof idRaw === "string" ? idRaw : "").trim();
  if (!matchId) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);
      const rows = await tx.$queryRaw<{ id: string; aEmail: string; bEmail: string; endedAt: Date | null; state: unknown }[]>`
        SELECT "id","aEmail","bEmail","endedAt","state"
        FROM "OnlineMatch"
        WHERE "id" = ${matchId}
        LIMIT 1
        FOR UPDATE
      `;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt) return { ok: true as const, ended: true as const };

      const now = Date.now();
      const role = m.aEmail === email ? ("a" as const) : ("b" as const);
      const { base, presence } = normalizePresenceState(m.state);
      const nextPresence =
        role === "a"
          ? { ...presence, a: { ...presence.a, lastSeenAt: now, disconnectedAt: 0 } }
          : { ...presence, b: { ...presence.b, lastSeenAt: now, disconnectedAt: 0 } };
      const nextState = { ...base, presence: nextPresence };
      await tx.$executeRaw`
        UPDATE "OnlineMatch"
        SET "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
        WHERE "id" = ${matchId}
      `;
      return { ok: true as const };
    });

    if (!out.ok) return NextResponse.json(out, { status: out.error === "forbidden" ? 403 : 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}


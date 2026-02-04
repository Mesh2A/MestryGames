import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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

      const rows = await tx.$queryRaw<
        {
          id: string;
          fee: number;
          aEmail: string;
          bEmail: string;
          winnerEmail: string | null;
          endedAt: Date | null;
          state: unknown;
        }[]
      >`SELECT "id","fee","aEmail","bEmail","winnerEmail","endedAt","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: true as const, ended: true as const };

      const winnerEmail = m.aEmail === email ? m.bEmail : m.aEmail;
      const pot = Math.max(0, Math.floor(m.fee)) * 2;
      const now = Date.now();
      const prevState = m.state && typeof m.state === "object" ? (m.state as Record<string, unknown>) : {};
      const nextState = { ...prevState, endedReason: "forfeit", forfeitedBy: email, forfeitedAt: now };

      await tx.$executeRaw`
        UPDATE "OnlineMatch"
        SET "winnerEmail" = ${winnerEmail}, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
        WHERE "id" = ${matchId}
      `;

      const profile = await tx.gameProfile.findUnique({ where: { email: winnerEmail }, select: { state: true } });
      const s = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(s);
      const updated = { ...s, coins: coins + pot };
      await tx.gameProfile.update({ where: { email: winnerEmail }, data: { state: updated } });

      return { ok: true as const, ended: true as const, winner: "them" as const };
    });

    if (!out.ok) return NextResponse.json(out, { status: out.error === "forbidden" ? 403 : 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

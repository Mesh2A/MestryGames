import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function normalizeStateForMatch(raw: unknown) {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = Array.isArray(base.a) ? base.a : [];
  const b = Array.isArray(base.b) ? base.b : [];
  const lastMasked = base.lastMasked && typeof base.lastMasked === "object" ? base.lastMasked : null;
  return { ...base, a, b, lastMasked, endedReason: "disabled", forfeitedBy: null };
}

async function refundCoins(tx: unknown, email: string, amount: number) {
  const client = tx as {
    gameProfile: {
      findUnique: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
    };
  };
  const profile = (await client.gameProfile.findUnique({ where: { email }, select: { state: true } })) as { state?: unknown } | null;
  const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
  const coins = readCoinsFromState(stateObj);
  const peak = readCoinsPeakFromState(stateObj);
  const add = Math.max(0, Math.floor(amount || 0));
  const nextCoins = coins + add;
  const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
  await client.gameProfile.update({ where: { email }, data: { state: nextState } });
  return nextCoins;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<{ onlineEnabled: boolean }[]>`
      SELECT "onlineEnabled" FROM "AppConfig" WHERE "id" = 'global' LIMIT 1
    `;
    const onlineEnabled = rows && rows[0] ? !!rows[0].onlineEnabled : true;
    return NextResponse.json({ onlineEnabled }, { status: 200 });
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

  const enabledRaw =
    body && typeof body === "object" && "onlineEnabled" in body
      ? (body as { onlineEnabled?: unknown }).onlineEnabled
      : body && typeof body === "object" && "enabled" in body
        ? (body as { enabled?: unknown }).enabled
        : null;
  const onlineEnabled = typeof enabledRaw === "boolean" ? enabledRaw : null;
  if (onlineEnabled === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    await ensureDbReady();
    const out = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "AppConfig" SET "onlineEnabled" = ${onlineEnabled}, "updatedAt" = NOW() WHERE "id" = 'global'
      `;

      if (!onlineEnabled) {
        const cancelled = await tx.$queryRaw<{ email: string; fee: number }[]>`
          UPDATE "OnlineQueue"
          SET "status" = 'cancelled', "updatedAt" = NOW()
          WHERE "status" = 'waiting'
          RETURNING "email", "fee"
        `;
        for (const row of cancelled) {
          await refundCoins(tx, row.email, row.fee);
        }

        const cancelledRooms = await tx.$queryRaw<{ hostEmail: string; fee: number }[]>`
          UPDATE "OnlineRoom"
          SET "status" = 'cancelled', "updatedAt" = NOW()
          WHERE "status" = 'waiting'
          RETURNING "hostEmail", "fee"
        `;
        for (const row of cancelledRooms) {
          await refundCoins(tx, row.hostEmail, row.fee);
        }

        const matches = await tx.$queryRaw<{ id: string; fee: number; aEmail: string; bEmail: string; state: unknown }[]>`
          SELECT "id", "fee", "aEmail", "bEmail", "state"
          FROM "OnlineMatch"
          WHERE "endedAt" IS NULL
          FOR UPDATE
        `;
        for (const m of matches) {
          const nextState = normalizeStateForMatch(m.state);
          await tx.$executeRaw`
            UPDATE "OnlineMatch"
            SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
            WHERE "id" = ${m.id}
          `;
          await refundCoins(tx, m.aEmail, m.fee);
          await refundCoins(tx, m.bEmail, m.fee);
        }
      }

      return { onlineEnabled };
    });

    await logAdminAction(String(adminEmail), "online_toggle", { onlineEnabled: out.onlineEnabled });
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

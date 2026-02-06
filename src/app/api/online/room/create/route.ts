import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

function normalizeMode(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "easy" || m === "medium" || m === "hard") return m;
  return "";
}

function configForMode(mode: "easy" | "medium" | "hard") {
  if (mode === "easy") return { fee: 29, codeLen: 3 };
  if (mode === "medium") return { fee: 45, codeLen: 4 };
  return { fee: 89, codeLen: 5 };
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
  return out;
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

  const onlineEnabled = await getOnlineEnabled();
  if (!onlineEnabled) return NextResponse.json({ error: "online_disabled" }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const modeRaw = body && typeof body === "object" && "mode" in body ? (body as { mode?: unknown }).mode : "";
  const mode = normalizeMode(typeof modeRaw === "string" ? modeRaw : "");
  if (!mode) return NextResponse.json({ error: "bad_mode" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const { fee, codeLen } = configForMode(mode as "easy" | "medium" | "hard");

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const existing = await tx.$queryRaw<{ code: string; mode: string; fee: number; codeLen: number; status: string }[]>`
        SELECT "code","mode","fee","codeLen","status"
        FROM "OnlineRoom"
        WHERE "hostEmail" = ${email} AND "status" = 'waiting'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (existing && existing[0]) {
        const r = existing[0];
        return { status: "waiting" as const, code: r.code, mode: r.mode, fee: r.fee, codeLen: r.codeLen };
      }

      const profileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const stateObj = profileRow?.state && typeof profileRow.state === "object" ? (profileRow.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(stateObj);
      if (coins < fee) return { status: "error" as const, error: "insufficient_coins" as const, coins };

      const peak = readCoinsPeakFromState(stateObj);
      const nextCoins = coins - fee;
      const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

      for (let attempt = 0; attempt < 7; attempt++) {
        const code = generateRoomCode();
        const inserted = await tx.$queryRaw<{ code: string }[]>`
          INSERT INTO "OnlineRoom" ("code","mode","fee","codeLen","hostEmail","guestEmail","status","matchId","createdAt","updatedAt")
          VALUES (${code}, ${mode}, ${fee}, ${codeLen}, ${email}, NULL, 'waiting', NULL, NOW(), NOW())
          ON CONFLICT ("code") DO NOTHING
          RETURNING "code"
        `;
        if (inserted && inserted[0]) return { status: "waiting" as const, code, mode, fee, codeLen, coins: nextCoins };
      }

      return { status: "error" as const, error: "code_unavailable" as const, coins: nextCoins };
    });

    if (out.status === "error") return NextResponse.json(out, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}


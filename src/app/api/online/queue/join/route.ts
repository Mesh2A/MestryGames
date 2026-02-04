import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail, getProfileLevel, getProfileStats } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

function randomId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function nowMs() {
  return Date.now();
}

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

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function readPhotoFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).photo;
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^data:image\/(png|jpeg|webp);base64,/i.test(s) && s.length < 150000 ? s : "";
}

function firstNameFromDisplayNameOrEmail(displayName: string, email: string) {
  const name = String(displayName || "").trim();
  if (name) return name;
  return firstNameFromEmail(email);
}

function generateAnswer(codeLen: number) {
  const digits: string[] = [];
  const used = new Set<number>();
  while (digits.length < codeLen) {
    const d = randomBytes(1)[0] % 10;
    if (used.has(d)) continue;
    used.add(d);
    digits.push(String(d));
  }
  return digits.join("");
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

  const modeRaw = body && typeof body === "object" && "mode" in body ? (body as { mode?: unknown }).mode : "";
  const mode = normalizeMode(typeof modeRaw === "string" ? modeRaw : "");
  if (!mode) return NextResponse.json({ error: "bad_mode" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const { fee, codeLen } = configForMode(mode as "easy" | "medium" | "hard");

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const existing = await tx.$queryRaw<
        { id: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number }[]
      >`SELECT "id", "status", "matchId", "mode", "fee", "codeLen" FROM "OnlineQueue" WHERE "email" = ${email} AND "status" = 'waiting' ORDER BY "createdAt" DESC LIMIT 1`;
      if (existing && existing[0]) {
        const row = existing[0];
        return { status: "waiting" as const, queueId: row.id, fee: row.fee, codeLen: row.codeLen, mode: row.mode };
      }

      const profileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const stateObj = profileRow?.state && typeof profileRow.state === "object" ? (profileRow.state as Record<string, unknown>) : {};
      const coins = readCoinsFromState(stateObj);
      if (coins < fee) return { status: "error" as const, error: "insufficient_coins" as const, coins };

      const peakRaw = stateObj.coinsPeak;
      const peak = typeof peakRaw === "number" && Number.isFinite(peakRaw) ? Math.max(0, Math.floor(peakRaw)) : coins;
      const nextCoins = coins - fee;
      const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins) };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

      const opponent = await tx.$queryRaw<{ id: string; email: string; fee: number; codeLen: number }[]>`
        SELECT "id", "email", "fee", "codeLen"
        FROM "OnlineQueue"
        WHERE "mode" = ${mode} AND "status" = 'waiting' AND "email" <> ${email}
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      if (!opponent.length) {
        const queueId = randomId("q");
        await tx.$executeRaw`
          INSERT INTO "OnlineQueue" ("id", "email", "mode", "fee", "codeLen", "status", "createdAt", "updatedAt")
          VALUES (${queueId}, ${email}, ${mode}, ${fee}, ${codeLen}, 'waiting', NOW(), NOW())
        `;
        return { status: "waiting" as const, queueId, fee, codeLen, mode };
      }

      const opp = opponent[0];
      const matchId = randomId("m");
      const answer = generateAnswer(codeLen);
      const aStarts = (randomBytes(1)[0] & 1) === 1;
      const aEmail = aStarts ? email : opp.email;
      const bEmail = aStarts ? opp.email : email;
      const turnEmail = aStarts ? email : opp.email;
      const turnStartedAt = nowMs();

      await tx.$executeRaw`
        UPDATE "OnlineQueue"
        SET "status" = 'matched', "matchId" = ${matchId}, "updatedAt" = NOW()
        WHERE "id" = ${opp.id}
      `;

      await tx.$executeRaw`
        INSERT INTO "OnlineMatch" ("id", "mode", "fee", "codeLen", "aEmail", "bEmail", "answer", "turnEmail", "turnStartedAt", "state", "createdAt", "updatedAt")
        VALUES (${matchId}, ${mode}, ${fee}, ${codeLen}, ${aEmail}, ${bEmail}, ${answer}, ${turnEmail}, ${turnStartedAt}, ${JSON.stringify({ a: [], b: [], lastMasked: null })}::jsonb, NOW(), NOW())
      `;

      const myQueueId = randomId("q");
      await tx.$executeRaw`
        INSERT INTO "OnlineQueue" ("id", "email", "mode", "fee", "codeLen", "status", "matchId", "createdAt", "updatedAt")
        VALUES (${myQueueId}, ${email}, ${mode}, ${fee}, ${codeLen}, 'matched', ${matchId}, NOW(), NOW())
      `;

      const oppProfile = await tx.gameProfile.findUnique({ where: { email: opp.email }, select: { email: true, publicId: true, state: true, createdAt: true } });
      return {
        status: "matched" as const,
        matchId,
        fee,
        codeLen,
        mode,
        opponent: oppProfile
          ? {
              id: oppProfile.publicId,
              firstName: firstNameFromDisplayNameOrEmail(readDisplayNameFromState(oppProfile.state), oppProfile.email),
              photo: readPhotoFromState(oppProfile.state),
              createdAt: oppProfile.createdAt.toISOString(),
              stats: getProfileStats(oppProfile.state),
              level: getProfileLevel(oppProfile.state).level,
            }
          : null,
      };
    });

    if (out.status === "error") return NextResponse.json(out, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

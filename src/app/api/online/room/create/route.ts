import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
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

function configForMode(mode: "easy" | "medium" | "hard", kind: "normal" | "custom" | "props") {
  const base = mode === "easy" ? { fee: 29, codeLen: 3 } : mode === "medium" ? { fee: 45, codeLen: 4 } : { fee: 89, codeLen: 5 };
  let fee = base.fee;
  if (kind === "custom") fee += 6;
  else if (kind === "props") fee += 12;
  return { fee, codeLen: base.codeLen };
}

function normalizeKind(kind: string) {
  const k = String(kind || "").trim().toLowerCase();
  if (k === "props" || k === "properties") return "props";
  if (k === "custom" || k === "specified" || k === "limited") return "custom";
  return "normal";
}

function parseRoomModeKey(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const };
  if (m.endsWith("_props")) return { mode: m.slice(0, -"_props".length), kind: "props" as const };
  return { mode: m, kind: "normal" as const };
}

const STALE_START_MS = 180_000;

function isStalePreStartState(state: unknown) {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const phase = typeof s.phase === "string" ? s.phase : "";
  if (phase === "play") return false;
  return phase === "setup" || phase === "cards" || phase === "waiting";
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

  const ban = await getActiveBan(email);
  if (ban) return NextResponse.json({ error: "banned", bannedUntilMs: ban.bannedUntilMs, reason: ban.reason }, { status: 403, headers: { "Cache-Control": "no-store" } });

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
  const kindRaw = body && typeof body === "object" && "kind" in body ? (body as { kind?: unknown }).kind : "";
  const kind = normalizeKind(typeof kindRaw === "string" ? kindRaw : "") as "normal" | "custom" | "props";

  const { fee, codeLen } = configForMode(mode as "easy" | "medium" | "hard", kind);

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const activeMatch = await tx.$queryRaw<
        { id: string; fee: number; aEmail: string; bEmail: string; cEmail: string | null; dEmail: string | null; state: unknown; updatedAt: Date }[]
      >`
        SELECT "id","fee","aEmail","bEmail","cEmail","dEmail","state","updatedAt"
        FROM "OnlineMatch"
        WHERE ("aEmail" = ${email} OR "bEmail" = ${email} OR "cEmail" = ${email} OR "dEmail" = ${email}) AND "endedAt" IS NULL AND "winnerEmail" IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (activeMatch && activeMatch[0]) {
        const row = activeMatch[0];
        const stale =
          row.updatedAt && Date.now() - row.updatedAt.getTime() > STALE_START_MS && isStalePreStartState(row.state);
        if (!stale) return { status: "error" as const, error: "already_in_match" as const, matchId: row.id };
        const prev = row.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
        const nextState = { ...prev, endedReason: "stale", forfeitedBy: null, endedAt: Date.now() };
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "winnerEmail" = NULL, "endedAt" = NOW(), "state" = ${JSON.stringify(nextState)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${row.id}
        `;
        const refund = async (who: string | null) => {
          if (!who) return;
          const profile = await tx.gameProfile.findUnique({ where: { email: who }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(row.fee));
          const nextCoins = coins + fee;
          const next = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email: who }, data: { state: next } });
        };
        await refund(row.aEmail);
        await refund(row.bEmail);
        await refund(row.cEmail);
        await refund(row.dEmail);
      }

      const activeQueue = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "OnlineQueue"
        WHERE "email" = ${email} AND "status" = 'waiting'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (activeQueue && activeQueue[0]) return { status: "error" as const, error: "already_in_queue" as const, queueId: activeQueue[0].id };

      const activeRoomAny = await tx.$queryRaw<{ code: string }[]>`
        SELECT "code"
        FROM "OnlineRoom"
        WHERE ("hostEmail" = ${email} OR "guestEmail" = ${email}) AND "status" = 'waiting'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (activeRoomAny && activeRoomAny[0]) return { status: "error" as const, error: "already_in_room" as const, code: activeRoomAny[0].code };

      const existing = await tx.$queryRaw<{ code: string; mode: string; fee: number; codeLen: number; status: string }[]>`
        SELECT "code","mode","fee","codeLen","status"
        FROM "OnlineRoom"
        WHERE "hostEmail" = ${email} AND "status" = 'waiting'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      if (existing && existing[0]) {
        const r = existing[0];
        const profileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const stateObj = profileRow?.state && typeof profileRow.state === "object" ? (profileRow.state as Record<string, unknown>) : {};
        const coins = readCoinsFromState(stateObj);
        const parsed = parseRoomModeKey(r.mode);
        return { status: "waiting" as const, code: r.code, mode: parsed.mode, kind: parsed.kind, fee: r.fee, codeLen: r.codeLen, coins };
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
          VALUES (${code}, ${kind === "custom" ? `${mode}_custom` : kind === "props" ? `${mode}_props` : mode}, ${fee}, ${codeLen}, ${email}, NULL, 'waiting', NULL, NOW(), NOW())
          ON CONFLICT ("code") DO NOTHING
          RETURNING "code"
        `;
        if (inserted && inserted[0]) return { status: "waiting" as const, code, mode, kind, fee, codeLen, coins: nextCoins };
      }

      return { status: "error" as const, error: "code_unavailable" as const, coins: nextCoins };
    });

    if (out.status === "error") return NextResponse.json(out, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const SEARCH_TIMEOUT_MS = 45_000;

function parseQueueMode(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const };
  if (m.endsWith("_props")) return { mode: m.slice(0, -"_props".length), kind: "props" as const };
  return { mode: m, kind: "normal" as const };
}

function randomId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function nowMs() {
  return Date.now();
}

function generateAnswer(codeLen: number) {
  const digits: string[] = [];
  const used = new Set<number>();
  const len = Math.max(3, Math.min(6, Math.floor(codeLen)));
  while (digits.length < len) {
    const d = randomBytes(1)[0] % 10;
    if (used.has(d)) continue;
    used.add(d);
    digits.push(String(d));
  }
  return digits.join("");
}

function generatePropsDeck() {
  const pool = ["skip_turn", "double_or_nothing", "reverse_digits", "hide_colors"];
  const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(pool[randomBytes(1)[0] % pool.length]);
  return out;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const id = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const onlineEnabled = await getOnlineEnabled();
    if (!onlineEnabled) {
      const out = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; email: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number; createdAt: Date }[]
        >`SELECT "id","email","status","matchId","mode","fee","codeLen","createdAt" FROM "OnlineQueue" WHERE "id" = ${id} LIMIT 1 FOR UPDATE`;
        const row = rows && rows[0] ? rows[0] : null;
        if (!row || row.email !== email) return { ok: false as const };
        if (row.status !== "waiting") {
          const parsed = parseQueueMode(row.mode);
          return {
            ok: true as const,
            status: row.status,
            matchId: row.matchId,
            mode: parsed.mode,
            kind: parsed.kind,
            fee: row.fee,
            codeLen: row.codeLen,
          };
        }

        await tx.$executeRaw`
          UPDATE "OnlineQueue" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE "id" = ${id}
        `;

        const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
        const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
        const coins = readCoinsFromState(stateObj);
        const peak = readCoinsPeakFromState(stateObj);
        const fee = Math.max(0, Math.floor(row.fee));
        const nextCoins = coins + fee;
        const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
        await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

        const parsed = parseQueueMode(row.mode);
        return {
          ok: true as const,
          status: "cancelled" as const,
          matchId: null,
          mode: parsed.mode,
          kind: parsed.kind,
          fee: row.fee,
          codeLen: row.codeLen,
          refunded: true as const,
          coins: nextCoins,
        };
      });
      if (!out.ok) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const rows = await prisma.$queryRaw<
      { id: string; email: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number; createdAt: Date }[]
    >`
      SELECT "id", "email", "status", "matchId", "mode", "fee", "codeLen", "createdAt"
      FROM "OnlineQueue"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    const row = rows && rows[0] ? rows[0] : null;
    if (!row || row.email !== email) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

    if (row.status === "waiting") {
      const matched = await prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<
          { id: string; email: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number }[]
        >`SELECT "id","email","status","matchId","mode","fee","codeLen" FROM "OnlineQueue" WHERE "id" = ${id} LIMIT 1 FOR UPDATE`;
        const locked = lockedRows && lockedRows[0] ? lockedRows[0] : null;
        if (!locked || locked.email !== email) return { ok: false as const };
        if (locked.status !== "waiting") {
          const parsed = parseQueueMode(locked.mode);
          return { ok: true as const, status: locked.status, matchId: locked.matchId, mode: parsed.mode, kind: parsed.kind, fee: locked.fee, codeLen: locked.codeLen };
        }

        const opponent = await tx.$queryRaw<{ id: string; email: string; fee: number; codeLen: number }[]>`
          SELECT "id", "email", "fee", "codeLen"
          FROM "OnlineQueue"
          WHERE "mode" = ${locked.mode} AND "status" = 'waiting' AND "email" <> ${email}
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;
        if (!opponent.length) return { ok: false as const };

        const opp = opponent[0];
        const matchId = randomId("m");
        const parsed = parseQueueMode(locked.mode);
        const codeLen = Math.max(3, Math.min(6, Math.floor(locked.codeLen || 0)));
        const answer = parsed.kind === "custom" ? "" : generateAnswer(codeLen);
        const aStarts = (randomBytes(1)[0] & 1) === 1;
        const aEmail = aStarts ? email : opp.email;
        const bEmail = aStarts ? opp.email : email;
        const turnEmail = aStarts ? email : opp.email;
        const turnStartedAt = parsed.kind === "custom" ? nowMs() : 0;

        const initialState =
          parsed.kind === "custom"
            ? { kind: "custom", phase: "setup", secrets: { a: null, b: null }, ready: { a: false, b: false }, a: [], b: [], lastMasked: null }
            : parsed.kind === "props"
              ? {
                  kind: "props",
                  phase: "cards",
                  deck: generatePropsDeck(),
                  pick: { a: null, b: null },
                  used: { a: false, b: false },
                  effects: { skipBy: null, reverseFor: null, hideColorsFor: null, doubleAgainst: null },
                  round: 1,
                  a: [],
                  b: [],
                  lastMasked: null,
                }
              : { kind: "normal", phase: "waiting", a: [], b: [], lastMasked: null };

        await tx.$executeRaw`
          INSERT INTO "OnlineMatch" ("id", "mode", "fee", "codeLen", "aEmail", "bEmail", "answer", "turnEmail", "turnStartedAt", "state", "createdAt", "updatedAt")
          VALUES (${matchId}, ${parsed.mode}, ${locked.fee}, ${codeLen}, ${aEmail}, ${bEmail}, ${answer}, ${turnEmail}, ${turnStartedAt}, ${JSON.stringify(initialState)}::jsonb, NOW(), NOW())
        `;

        await tx.$executeRaw`
          UPDATE "OnlineQueue"
          SET "status" = 'matched', "matchId" = ${matchId}, "updatedAt" = NOW()
          WHERE "id" IN (${locked.id}, ${opp.id})
        `;

        return {
          ok: true as const,
          status: "matched" as const,
          matchId,
          mode: parsed.mode,
          kind: parsed.kind,
          fee: locked.fee,
          codeLen,
        };
      });

      if (matched && matched.ok) {
        return NextResponse.json(matched, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
      const createdAtMs = row.createdAt ? row.createdAt.getTime() : 0;
      if (createdAtMs && Date.now() - createdAtMs >= SEARCH_TIMEOUT_MS) {
        const out = await prisma.$transaction(async (tx) => {
          const lockedRows = await tx.$queryRaw<
            { id: string; email: string; status: string; matchId: string | null; mode: string; fee: number; codeLen: number }[]
          >`SELECT "id","email","status","matchId","mode","fee","codeLen" FROM "OnlineQueue" WHERE "id" = ${id} LIMIT 1 FOR UPDATE`;
          const locked = lockedRows && lockedRows[0] ? lockedRows[0] : null;
          if (!locked || locked.email !== email) return { ok: false as const };
          if (locked.status !== "waiting") {
            const parsed = parseQueueMode(locked.mode);
            return { ok: true as const, status: locked.status, matchId: locked.matchId, mode: parsed.mode, kind: parsed.kind, fee: locked.fee, codeLen: locked.codeLen };
          }

          await tx.$executeRaw`UPDATE "OnlineQueue" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE "id" = ${id}`;

          const profile = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
          const stateObj = profile?.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};
          const coins = readCoinsFromState(stateObj);
          const peak = readCoinsPeakFromState(stateObj);
          const fee = Math.max(0, Math.floor(locked.fee));
          const nextCoins = coins + fee;
          const nextState = { ...stateObj, coins: nextCoins, coinsPeak: Math.max(peak, nextCoins), lastWriteAt: Date.now() };
          await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

          const parsed = parseQueueMode(locked.mode);
          return {
            ok: true as const,
            status: "cancelled" as const,
            matchId: null,
            mode: parsed.mode,
            kind: parsed.kind,
            fee: locked.fee,
            codeLen: locked.codeLen,
            refunded: true as const,
            coins: nextCoins,
            reason: "timeout" as const,
          };
        });
        if (!out.ok) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
        return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
    }

    const parsed = parseQueueMode(row.mode);
    return NextResponse.json(
      { status: row.status, matchId: row.matchId, mode: parsed.mode, kind: parsed.kind, fee: row.fee, codeLen: row.codeLen },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

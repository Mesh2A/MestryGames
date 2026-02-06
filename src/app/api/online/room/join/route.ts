import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile, readCoinsFromState, readCoinsPeakFromState } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
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

function normalizeCode(code: string) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
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

function normalizeKind(kind: string) {
  const k = String(kind || "").trim().toLowerCase();
  if (k === "custom" || k === "specified" || k === "limited") return "custom";
  return "normal";
}

function parseRoomModeKey(mode: string) {
  const m = String(mode || "").trim().toLowerCase();
  if (m.endsWith("_custom")) return { mode: m.slice(0, -"_custom".length), kind: "custom" as const };
  return { mode: m, kind: "normal" as const };
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

  const codeRaw = body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : "";
  const kindRaw = body && typeof body === "object" && "kind" in body ? (body as { kind?: unknown }).kind : "";
  const code = normalizeCode(typeof codeRaw === "string" ? codeRaw : "");
  if (!code) return NextResponse.json({ error: "missing_code" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const kindReq = typeof kindRaw === "string" ? normalizeKind(kindRaw) : "";

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        { code: string; mode: string; fee: number; codeLen: number; hostEmail: string; guestEmail: string | null; status: string; matchId: string | null }[]
      >`SELECT "code","mode","fee","codeLen","hostEmail","guestEmail","status","matchId" FROM "OnlineRoom" WHERE "code" = ${code} LIMIT 1 FOR UPDATE`;
      const room = rows && rows[0] ? rows[0] : null;
      if (!room) return { status: "error" as const, error: "room_not_found" as const };
      if (room.status !== "waiting") return { status: "error" as const, error: "room_full" as const };
      if (room.hostEmail === email) return { status: "error" as const, error: "cannot_join_own" as const };
      const parsed = parseRoomModeKey(room.mode);
      if (kindReq && kindReq !== parsed.kind) return { status: "error" as const, error: "room_kind_mismatch" as const };

      const myProfileRow = await tx.gameProfile.findUnique({ where: { email }, select: { state: true } });
      const myStateObj = myProfileRow?.state && typeof myProfileRow.state === "object" ? (myProfileRow.state as Record<string, unknown>) : {};
      const myCoins = readCoinsFromState(myStateObj);
      const fee = Math.max(0, Math.floor(room.fee));
      if (myCoins < fee) return { status: "error" as const, error: "insufficient_coins" as const, coins: myCoins };

      const myPeak = readCoinsPeakFromState(myStateObj);
      const nextCoins = myCoins - fee;
      const nextState = { ...myStateObj, coins: nextCoins, coinsPeak: Math.max(myPeak, nextCoins), lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });

      const matchId = randomId("m");
      const answer = parsed.kind === "custom" ? "" : generateAnswer(Math.max(1, Math.floor(room.codeLen)));
      const aStarts = (randomBytes(1)[0] & 1) === 1;
      const aEmail = aStarts ? room.hostEmail : email;
      const bEmail = aStarts ? email : room.hostEmail;
      const turnEmail = aStarts ? room.hostEmail : email;
      const turnStartedAt = nowMs();

      const initialState =
        parsed.kind === "custom"
          ? { kind: "custom", phase: "setup", secrets: { a: null, b: null }, ready: { a: false, b: false }, a: [], b: [], lastMasked: null }
          : { a: [], b: [], lastMasked: null };

      await tx.$executeRaw`
        INSERT INTO "OnlineMatch" ("id", "mode", "fee", "codeLen", "aEmail", "bEmail", "answer", "turnEmail", "turnStartedAt", "state", "createdAt", "updatedAt")
        VALUES (${matchId}, ${parsed.mode}, ${fee}, ${room.codeLen}, ${aEmail}, ${bEmail}, ${answer}, ${turnEmail}, ${turnStartedAt}, ${JSON.stringify(initialState)}::jsonb, NOW(), NOW())
      `;

      await tx.$executeRaw`
        UPDATE "OnlineRoom"
        SET "guestEmail" = ${email}, "status" = 'matched', "matchId" = ${matchId}, "updatedAt" = NOW()
        WHERE "code" = ${code}
      `;

      const hostProfile = await tx.gameProfile.findUnique({
        where: { email: room.hostEmail },
        select: { email: true, publicId: true, state: true, createdAt: true },
      });

      return {
        status: "matched" as const,
        matchId,
        fee,
        codeLen: room.codeLen,
        mode: parsed.mode,
        kind: parsed.kind,
        coins: nextCoins,
        opponent: hostProfile
          ? {
              id: hostProfile.publicId,
              firstName: firstNameFromDisplayNameOrEmail(readDisplayNameFromState(hostProfile.state), hostProfile.email),
              photo: readPhotoFromState(hostProfile.state),
              createdAt: hostProfile.createdAt.toISOString(),
              stats: getProfileStats(hostProfile.state),
              level: getProfileLevel(hostProfile.state).level,
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

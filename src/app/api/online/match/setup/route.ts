import { authOptions } from "@/lib/auth";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile } from "@/lib/gameProfile";
import { getOnlineEnabled } from "@/lib/onlineConfig";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function isDigitsN(s: string, len: number) {
  if (typeof s !== "string") return false;
  if (s.length !== len) return false;
  return /^\d+$/.test(s);
}

function safeState(raw: unknown) {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = s.kind === "custom" ? ("custom" as const) : ("normal" as const);
  const phase = kind === "custom" && s.phase === "setup" ? ("setup" as const) : ("play" as const);
  const secrets = s.secrets && typeof s.secrets === "object" ? (s.secrets as Record<string, unknown>) : {};
  const ready = s.ready && typeof s.ready === "object" ? (s.ready as Record<string, unknown>) : {};
  const readyA = ready.a === true;
  const readyB = ready.b === true;
  const secretA = typeof secrets.a === "string" ? secrets.a : "";
  const secretB = typeof secrets.b === "string" ? secrets.b : "";
  return { kind, phase, readyA, readyB, secretA, secretB, raw: s };
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

  const matchIdRaw = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : "";
  const secretRaw = body && typeof body === "object" && "secret" in body ? (body as { secret?: unknown }).secret : "";
  const readyRaw = body && typeof body === "object" && "ready" in body ? (body as { ready?: unknown }).ready : false;

  const matchId = String(typeof matchIdRaw === "string" ? matchIdRaw : "").trim();
  const secret = String(typeof secretRaw === "string" ? secretRaw : "").trim();
  const ready = readyRaw === true;
  const unready = readyRaw === false;

  if (!matchId) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await ensureGameProfile(email);

      const rows = await tx.$queryRaw<
        { id: string; codeLen: number; aEmail: string; bEmail: string; endedAt: Date | null; winnerEmail: string | null; state: unknown }[]
      >`SELECT "id","codeLen","aEmail","bEmail","endedAt","winnerEmail","state" FROM "OnlineMatch" WHERE "id" = ${matchId} LIMIT 1 FOR UPDATE`;
      const m = rows && rows[0] ? rows[0] : null;
      if (!m) return { ok: false as const, error: "not_found" as const };
      if (m.aEmail !== email && m.bEmail !== email) return { ok: false as const, error: "forbidden" as const };
      if (m.endedAt || m.winnerEmail) return { ok: false as const, error: "ended" as const };

      const role = m.aEmail === email ? ("a" as const) : ("b" as const);
      const s = safeState(m.state);
      if (s.kind !== "custom") return { ok: false as const, error: "bad_mode" as const };
      if (s.phase !== "setup") return { ok: false as const, error: "already_started" as const };

      const len = Math.max(3, Math.min(6, Math.floor(m.codeLen || 0)));

      const next = { ...s.raw };
      const nextSecrets = next.secrets && typeof next.secrets === "object" ? { ...(next.secrets as Record<string, unknown>) } : {};
      const nextReady = next.ready && typeof next.ready === "object" ? { ...(next.ready as Record<string, unknown>) } : {};

      const wasReady = role === "a" ? s.readyA : s.readyB;
      if (ready) {
        if (wasReady) return { ok: false as const, error: "already_ready" as const };
        if (!isDigitsN(secret, len)) return { ok: false as const, error: "bad_secret" as const };
        nextSecrets[role] = secret;
        nextReady[role] = true;
      } else if (unready) {
        nextReady[role] = false;
        if (secret) {
          if (!isDigitsN(secret, len)) return { ok: false as const, error: "bad_secret" as const };
          nextSecrets[role] = secret;
        }
      } else {
        if (!isDigitsN(secret, len)) return { ok: false as const, error: "bad_secret" as const };
        nextSecrets[role] = secret;
      }

      next.secrets = nextSecrets;
      next.ready = nextReady;

      const readyA = nextReady.a === true;
      const readyB = nextReady.b === true;
      const now = Date.now();

      if (readyA && readyB) {
        next.phase = "play";
        const aStarts = (now & 1) === 1;
        const turnEmail = aStarts ? m.aEmail : m.bEmail;
        await tx.$executeRaw`
          UPDATE "OnlineMatch"
          SET "turnEmail" = ${turnEmail}, "turnStartedAt" = ${now}, "state" = ${JSON.stringify(next)}::jsonb, "updatedAt" = NOW()
          WHERE "id" = ${matchId}
        `;
        return {
          ok: true as const,
          phase: "play" as const,
          myReady: true as const,
          oppReady: true as const,
        };
      }

      await tx.$executeRaw`
        UPDATE "OnlineMatch"
        SET "state" = ${JSON.stringify(next)}::jsonb, "updatedAt" = NOW()
        WHERE "id" = ${matchId}
      `;

      return {
        ok: true as const,
        phase: "setup" as const,
        myReady: nextReady[role] === true,
        oppReady: role === "a" ? readyB : readyA,
      };
    });

    if (!out.ok) {
      const status = out.error === "forbidden" ? 403 : out.error === "not_found" ? 404 : 409;
      return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

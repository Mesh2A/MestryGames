import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function readNameChangeState(state: unknown) {
  if (!state || typeof state !== "object") return { freeUsed: false, credits: 0 };
  const nc = (state as Record<string, unknown>).nameChange;
  if (!nc || typeof nc !== "object") return { freeUsed: false, credits: 0 };
  const freeUsedRaw = (nc as Record<string, unknown>).freeUsed;
  const creditsRaw = (nc as Record<string, unknown>).credits;
  const freeUsed = !!freeUsedRaw;
  const credits =
    typeof creditsRaw === "number" && Number.isFinite(creditsRaw)
      ? Math.max(0, Math.floor(creditsRaw))
      : typeof creditsRaw === "string"
        ? Math.max(0, Math.floor(parseInt(creditsRaw, 10) || 0))
        : 0;
  return { freeUsed, credits };
}

function normalizeDisplayName(name: string) {
  const s = String(name || "").replace(/\s+/g, " ").trim();
  return s;
}

function isValidDisplayName(name: string) {
  const s = String(name || "").trim();
  if (s.length < 2) return false;
  if (s.length > 18) return false;
  return true;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const profile = await ensureGameProfile(email);
    const displayName =
      profile.state && typeof profile.state === "object" && typeof (profile.state as Record<string, unknown>).displayName === "string"
        ? String((profile.state as Record<string, unknown>).displayName).trim()
        : "";
    const nc = readNameChangeState(profile.state);
    return NextResponse.json({ displayName, freeUsed: nc.freeUsed, credits: nc.credits }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const raw =
    body && typeof body === "object" && "displayName" in body && typeof (body as { displayName?: unknown }).displayName === "string"
      ? (body as { displayName: string }).displayName
      : "";
  const displayName = normalizeDisplayName(raw);
  if (!isValidDisplayName(displayName)) return NextResponse.json({ error: "invalid_name" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const out = await prisma.$transaction(async (tx) => {
      const row = await tx.gameProfile.findUnique({ where: { email } });
      const state = row && row.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
      const nc = readNameChangeState(state);

      let nextNc = nc;
      if (!nc.freeUsed) nextNc = { freeUsed: true, credits: nc.credits };
      else if (nc.credits > 0) nextNc = { freeUsed: true, credits: nc.credits - 1 };
      else return { ok: false as const, error: "payment_required" as const, freeUsed: nc.freeUsed, credits: nc.credits };

      const nextState = { ...state, displayName, nameChange: nextNc, lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
      return { ok: true as const, displayName, freeUsed: nextNc.freeUsed, credits: nextNc.credits };
    });

    if (!out.ok) return NextResponse.json(out, { status: 402 });
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


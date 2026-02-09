import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function intFromUnknown(x: unknown) {
  if (typeof x === "number" && Number.isFinite(x)) return Math.floor(x);
  if (typeof x === "string") return Math.floor(parseInt(x, 10) || 0);
  return 0;
}

function readCoinsFromState(state: unknown) {
  if (!state || typeof state !== "object") return 0;
  const coinsRaw = (state as Record<string, unknown>).coins;
  const coins = intFromUnknown(coinsRaw);
  return Math.max(0, coins);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    await ensureDbReady();
    const profile = await prisma.gameProfile.findUnique({ where: { email } });
    const coins = readCoinsFromState(profile?.state);
    return NextResponse.json({ email, exists: !!profile, coins }, { status: 200 });
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

  const email =
    body && typeof body === "object" && "email" in body && typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  const op =
    body && typeof body === "object" && "op" in body && typeof (body as { op?: unknown }).op === "string"
      ? (body as { op: string }).op
      : "";
  const amount =
    body && typeof body === "object" && "amount" in body ? intFromUnknown((body as { amount?: unknown }).amount) : 0;

  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });
  if (op !== "set" && op !== "add") return NextResponse.json({ error: "invalid_op" }, { status: 400 });
  if (!Number.isFinite(amount)) return NextResponse.json({ error: "invalid_amount" }, { status: 400 });

  const normalizedAmount = Math.max(0, Math.floor(amount));

  try {
    await ensureDbReady();
    const out = await prisma.$transaction(async (tx) => {
      const profile = await tx.gameProfile.findUnique({ where: { email } });
      const existingState =
        profile && profile.state && typeof profile.state === "object" ? (profile.state as Record<string, unknown>) : {};

      const previousCoins = readCoinsFromState(existingState);
      const totalCoins = op === "set" ? normalizedAmount : previousCoins + normalizedAmount;

      if (!profile) {
        const created = await tx.gameProfile.create({
          data: {
            email,
            state: { ...existingState, coins: totalCoins, lastWriteAt: Date.now() },
          },
        });
        return { email, previousCoins, totalCoins: readCoinsFromState(created.state), created: true };
      }

      const nextState = { ...existingState, coins: totalCoins, lastWriteAt: Date.now() };
      await tx.gameProfile.update({ where: { email }, data: { state: nextState } });
      return { email, previousCoins, totalCoins, created: false };
    });

    const delta = (out.totalCoins as number) - (out.previousCoins as number);
    await logAdminAction(String(adminEmail), "coins", {
      email: out.email,
      op,
      amount: normalizedAmount,
      previousCoins: out.previousCoins,
      totalCoins: out.totalCoins,
      delta,
    });

    return NextResponse.json({ ok: true, ...out }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

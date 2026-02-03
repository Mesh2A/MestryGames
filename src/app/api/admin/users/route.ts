import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
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

function firstNameFromEmail(email: string) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[^a-zA-Z0-9_ .-]+/g, " ").trim();
  const token = cleaned.split(/[\s._-]+/g).filter(Boolean)[0] || local;
  return token.slice(0, 1).toUpperCase() + token.slice(1);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const takeRaw = req.nextUrl.searchParams.get("take");
  const take = Math.max(1, Math.min(200, intFromUnknown(takeRaw)));

  try {
    const rows = await prisma.gameProfile.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { updatedAt: "desc" },
      take,
      select: { email: true, createdAt: true, updatedAt: true, state: true },
    });

    const users = rows.map((r) => ({
      email: r.email,
      firstName: firstNameFromEmail(r.email),
      coins: readCoinsFromState(r.state),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ users }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });
  if (email === String(adminEmail || "").trim().toLowerCase()) return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });

  try {
    await prisma.gameProfile.delete({ where: { email } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "P2025") return NextResponse.json({ ok: true, missing: true }, { status: 200 });
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await ensureGameProfile(email);
    const row = await prisma.gameProfile.findUnique({ where: { email } });
    if (row?.state && typeof row.state === "object") return NextResponse.json({ state: row.state }, { status: 200 });

    if (!row) {
      const created = await prisma.gameProfile.create({ data: { email, state: {} } });
      return NextResponse.json({ state: created.state }, { status: 200 });
    }

    return NextResponse.json({ state: {} }, { status: 200 });
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

  const state =
    body && typeof body === "object" && "state" in body
      ? (body as { state?: unknown }).state ?? null
      : null;
  if (!state || typeof state !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    await prisma.gameProfile.update({ where: { email }, data: { state } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

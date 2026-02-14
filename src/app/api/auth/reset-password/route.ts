import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const tokenRaw = body && typeof body === "object" && "token" in body ? (body as { token?: unknown }).token : "";
  const passwordRaw = body && typeof body === "object" && "password" in body ? (body as { password?: unknown }).password : "";

  const token = String(typeof tokenRaw === "string" ? tokenRaw : "").trim();
  const password = String(typeof passwordRaw === "string" ? passwordRaw : "");

  if (!token) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "bad_password" }, { status: 400 });

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const row = await prisma.resetToken.findUnique({ where: { tokenHash } });
  if (!row || row.used || row.expiresAt <= now) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.gameProfile.update({
      where: { email: row.email },
      data: { passwordHash: hashPassword(password) },
    });
    await tx.resetToken.update({ where: { id: row.id }, data: { used: true } });
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

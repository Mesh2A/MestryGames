import { isAdminEmail } from "@/lib/admin";
import { hashPassword } from "@/lib/password";
import { generatePublicId } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

function normalizeUsername(username: string) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function ensureProfileTx(tx: Prisma.TransactionClient, email: string) {
  const admin = isAdminEmail(email);
  let existing = await tx.gameProfile.findUnique({ where: { email } });
  if (existing?.publicId && (!admin || existing.publicId === "M1")) return existing;

  for (let attempt = 0; attempt < 7; attempt++) {
    const publicId = admin ? "M1" : generatePublicId(11);
    try {
      if (!existing) {
        return await tx.gameProfile.create({
          data: { email, publicId, state: {} },
        });
      }

      return await tx.gameProfile.update({
        where: { email },
        data: { publicId },
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code === "P2002") {
        if (admin) {
          const owner = await tx.gameProfile.findUnique({ where: { publicId: "M1" } });
          if (owner?.email === email) return owner;
          if (owner) {
            await tx.gameProfile.update({
              where: { email: owner.email },
              data: { publicId: generatePublicId(11) },
            });
          }
          continue;
        }
        existing = await tx.gameProfile.findUnique({ where: { email } });
        if (existing?.publicId) return existing;
        continue;
      }
      throw e;
    }
  }

  throw new Error("public_id_unavailable");
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const usernameRaw = body && typeof body === "object" && "username" in body ? (body as { username?: unknown }).username : "";
  const emailRaw = body && typeof body === "object" && "email" in body ? (body as { email?: unknown }).email : "";
  const passwordRaw = body && typeof body === "object" && "password" in body ? (body as { password?: unknown }).password : "";

  const username = normalizeUsername(typeof usernameRaw === "string" ? usernameRaw : "");
  const email = String(typeof emailRaw === "string" ? emailRaw : "")
    .trim()
    .toLowerCase();
  const password = typeof passwordRaw === "string" ? passwordRaw : "";

  if (!/^[a-z0-9_]{3,18}$/.test(username)) return NextResponse.json({ error: "bad_username" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "bad_email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "bad_password" }, { status: 400 });

  const passwordHash = hashPassword(password);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const usernameOwner = await tx.gameProfile.findFirst({ where: { username }, select: { email: true } });
      if (usernameOwner && usernameOwner.email !== email) return { ok: false as const, error: "username_taken" as const };

      const existing = await tx.gameProfile.findUnique({
        where: { email },
        select: { email: true, passwordHash: true, username: true },
      });
      if (existing?.passwordHash) return { ok: false as const, error: "already_registered" as const };

      await ensureProfileTx(tx, email);
      await tx.gameProfile.update({
        where: { email },
        data: { username, passwordHash },
      });
      return { ok: true as const };
    });

    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 409 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "P2002") return NextResponse.json({ error: "conflict" }, { status: 409 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

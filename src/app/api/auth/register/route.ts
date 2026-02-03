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

function credentialsEmailForUsername(username: string) {
  return `${username}@mestry.local`;
}

async function createCredentialsProfileTx(tx: Prisma.TransactionClient, args: { username: string; contactEmail: string; passwordHash: string }) {
  const email = credentialsEmailForUsername(args.username);

  for (let attempt = 0; attempt < 7; attempt++) {
    const publicId = generatePublicId(11);
    try {
      return await tx.gameProfile.create({
        data: {
          email,
          contactEmail: args.contactEmail,
          username: args.username,
          passwordHash: args.passwordHash,
          publicId,
          state: { displayName: args.username },
        },
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code === "P2002") continue;
      throw e;
    }
  }

  throw new Error("create_profile_failed");
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
      const usernameOwner = await tx.gameProfile.findFirst({ where: { username }, select: { id: true } });
      if (usernameOwner) return { ok: false as const, error: "username_taken" as const };

      const emailOwner = await tx.gameProfile.findFirst({
        where: { OR: [{ email }, { contactEmail: email }] },
        select: { id: true },
      });
      if (emailOwner) return { ok: false as const, error: "email_taken" as const };

      await createCredentialsProfileTx(tx, { username, contactEmail: email, passwordHash });
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

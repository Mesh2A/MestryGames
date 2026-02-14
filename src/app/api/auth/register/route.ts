import { hashPassword } from "@/lib/password";
import { generatePublicId } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { ensureDbReady } from "@/lib/ensureDb";
import { notifyDiscord } from "@/lib/discord";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

function normalizeUsername(username: string) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function createCredentialsProfileTx(tx: Prisma.TransactionClient, args: { username: string; email: string; passwordHash: string }) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const publicId = generatePublicId(11);
    try {
      return await tx.gameProfile.create({
        data: {
          email: args.email,
          contactEmail: args.email,
          username: args.username,
          passwordHash: args.passwordHash,
          publicId,
          state: {
            displayName: args.username,
            coins: 300,
            coinsPeak: 300,
            coinsEarnedTotal: 300,
            lastWriteAt: Date.now(),
          },
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
  try {
    await ensureDbReady();
  } catch {
    await notifyDiscord("errors", { title: "Register failed (storage unavailable)" });
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
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
        select: { email: true, passwordHash: true, publicId: true, username: true },
      });
      if (emailOwner) {
        if (emailOwner.email === email && !emailOwner.passwordHash) {
          for (let attempt = 0; attempt < 7; attempt++) {
            try {
              const out = await tx.gameProfile.update({
                where: { email },
                data: {
                  username,
                  passwordHash,
                  contactEmail: email,
                  publicId: emailOwner.publicId || generatePublicId(11),
                },
                select: { publicId: true, username: true, email: true },
              });
              return { ok: true as const, profile: out, mode: "upgraded" as const };
            } catch (e) {
              const code = (e as { code?: unknown }).code;
              if (code === "P2002") continue;
              throw e;
            }
          }
          throw new Error("create_profile_failed");
        }
        return { ok: false as const, error: "email_taken" as const };
      }

      const created = await createCredentialsProfileTx(tx, { username, email, passwordHash });
      return { ok: true as const, profile: { publicId: created.publicId, username: created.username, email: created.email }, mode: "created" as const };
    });

    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 409 });
    const profile = "profile" in updated ? updated.profile : null;
    await notifyDiscord("signup", {
      title: updated.mode === "upgraded" ? "User registered (credentials linked)" : "User registered",
      email,
      fields: [
        { name: "Username", value: username, inline: true },
        { name: "Public ID", value: profile && "publicId" in profile ? String((profile as { publicId?: unknown }).publicId || "—") : "—", inline: true },
      ],
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "P1001") {
      await notifyDiscord("errors", { title: "Register failed (storage unavailable)", email, fields: [{ name: "Code", value: "P1001", inline: true }] });
      return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
    }
    if (code === "P2002") return NextResponse.json({ error: "conflict" }, { status: 409 });
    await notifyDiscord("errors", {
      title: "Register failed (server error)",
      email,
      fields: [{ name: "Code", value: typeof code === "string" ? code : "unknown", inline: true }],
    });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

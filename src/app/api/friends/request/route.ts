import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rateLimit";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = consumeRateLimit(`friend_request:${email}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const id =
    body && typeof body === "object" && "id" in body && typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id.trim().toUpperCase()
      : "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  if (!/^[A-Z0-9]{2,16}$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  try {
    const me = await ensureGameProfile(email);
    if (me.publicId && me.publicId.toUpperCase() === id) return NextResponse.json({ error: "cannot_add_self" }, { status: 400 });

    const target = await prisma.gameProfile.findUnique({ where: { publicId: id } });
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const targetEnsured = target.publicId ? target : await ensureGameProfile(target.email);
    const [aEmail, bEmail] = sortPair(email, targetEnsured.email);

    const existingFriend = await prisma.friendship.findUnique({ where: { aEmail_bEmail: { aEmail, bEmail } } });
    if (existingFriend) return NextResponse.json({ ok: true, alreadyFriends: true }, { status: 200 });

    const reverse = await prisma.friendRequest.findUnique({ where: { fromEmail_toEmail: { fromEmail: targetEnsured.email, toEmail: email } } });
    if (reverse) {
      await prisma.$transaction(async (tx) => {
        await tx.friendship.create({ data: { aEmail, bEmail } });
        await tx.friendRequest.delete({ where: { fromEmail_toEmail: { fromEmail: targetEnsured.email, toEmail: email } } });
        await tx.friendRequestEvent.create({ data: { fromEmail: email, toEmail: targetEnsured.email, action: "accepted" } });
      });
      return NextResponse.json({ ok: true, accepted: true }, { status: 200 });
    }

    try {
      await prisma.friendRequest.create({ data: { fromEmail: email, toEmail: targetEnsured.email } });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code !== "P2002") throw e;
    }

    return NextResponse.json({ ok: true, pending: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

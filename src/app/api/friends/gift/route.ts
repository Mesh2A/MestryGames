import { authOptions } from "@/lib/auth";
import { ensureGameProfile, readCoinsFromState } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const giftCoins = 1;
const cooldownMs = 24 * 60 * 60 * 1000;

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
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

  const id =
    body && typeof body === "object" && "id" in body && typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id.trim().toUpperCase()
      : "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const target = await prisma.gameProfile.findUnique({ where: { publicId: id } });
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (target.email === email) return NextResponse.json({ error: "cannot_gift_self" }, { status: 400 });

    const now = Date.now();
    const [aEmail, bEmail] = sortPair(email, target.email);

    const out = await prisma.$transaction(async (tx) => {
      const link = await tx.friendship.findUnique({ where: { aEmail_bEmail: { aEmail, bEmail } } });
      if (!link) return { kind: "not_friends" as const };

      const existing = await tx.friendGift.findUnique({ where: { fromEmail_toEmail: { fromEmail: email, toEmail: target.email } } });
      const lastGiftAt = existing?.lastGiftAt ? existing.lastGiftAt.getTime() : 0;
      const availableAt = lastGiftAt ? lastGiftAt + cooldownMs : 0;
      if (lastGiftAt && now < availableAt) return { kind: "cooldown" as const, availableAt };

      await tx.friendGift.upsert({
        where: { fromEmail_toEmail: { fromEmail: email, toEmail: target.email } },
        create: { fromEmail: email, toEmail: target.email, lastGiftAt: new Date(now) },
        update: { lastGiftAt: new Date(now) },
      });

      const receiver = await tx.gameProfile.findUnique({ where: { email: target.email } });
      const receiverState =
        receiver && receiver.state && typeof receiver.state === "object" ? (receiver.state as Record<string, unknown>) : {};
      const prevCoins = readCoinsFromState(receiverState);
      const nextCoins = prevCoins + giftCoins;
      const nextState = { ...receiverState, coins: nextCoins, lastWriteAt: now };

      await tx.gameProfile.update({ where: { email: target.email }, data: { state: nextState } });
      await tx.friendGiftEvent.create({ data: { fromEmail: email, toEmail: target.email, coins: giftCoins } });
      return { kind: "ok" as const, coinsAdded: giftCoins, nextCoins, nextAvailableAt: now + cooldownMs };
    });

    if (out.kind === "not_friends") return NextResponse.json({ error: "not_friends" }, { status: 403 });
    if (out.kind === "cooldown") return NextResponse.json({ error: "cooldown", availableAt: out.availableAt }, { status: 429 });
    return NextResponse.json({ ok: true, ...out }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

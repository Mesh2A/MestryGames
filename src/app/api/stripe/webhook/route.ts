import { prisma } from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { notifyDiscord } from "@/lib/discord";

type StripeEvent = {
  type?: string;
  data?: {
    object?: unknown;
  };
};

type StripeCheckoutSession = {
  id?: string;
  payment_status?: string;
  currency?: string;
  amount_total?: number;
  metadata?: {
    coins?: string;
    nameChangeCredits?: string;
    packId?: string;
    profileEmail?: string;
  };
  customer_email?: string;
  client_reference_id?: string;
};

function parseStripeSignatureHeader(value: string) {
  const parts = String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  let timestamp = "";
  const v1: string[] = [];

  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    const val = p.slice(idx + 1);
    if (k === "t") timestamp = val;
    if (k === "v1") v1.push(val);
  }

  return { timestamp, v1 };
}

function safeEqualHex(aHex: string, bHex: string) {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const signature = req.headers.get("stripe-signature") || "";
  const { timestamp, v1 } = parseStripeSignatureHeader(signature);
  if (!timestamp || !v1.length) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  const rawBody = await req.text();
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  const nowSec = Math.floor(Date.now() / 1000);
  const tSec = Math.floor(parseInt(timestamp, 10) || 0);
  const toleranceSec = 5 * 60;
  if (!tSec || Math.abs(nowSec - tSec) > toleranceSec) return NextResponse.json({ error: "stale_signature" }, { status: 400 });

  const ok = v1.some((sig) => {
    try {
      return safeEqualHex(sig, expected);
    } catch {
      return false;
    }
  });
  if (!ok) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  let evt: StripeEvent = {};
  try {
    evt = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const type = typeof evt.type === "string" ? evt.type : "";
  if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const session = (evt.data && evt.data.object && typeof evt.data.object === "object" ? evt.data.object : {}) as StripeCheckoutSession;
  const sessionId = typeof session.id === "string" ? session.id : "";
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const paymentStatus = typeof session.payment_status === "string" ? session.payment_status : "";
  if (paymentStatus !== "paid") return NextResponse.json({ received: true, ignored: "not_paid" }, { status: 200 });

  const coinsStr = typeof session.metadata?.coins === "string" ? session.metadata.coins : "0";
  const coins = Math.max(0, Math.floor(parseInt(coinsStr, 10) || 0));
  const nameCreditsStr = typeof session.metadata?.nameChangeCredits === "string" ? session.metadata.nameChangeCredits : "0";
  const nameChangeCredits = Math.max(0, Math.floor(parseInt(nameCreditsStr, 10) || 0));
  if (!coins && !nameChangeCredits) return NextResponse.json({ error: "invalid_purchase" }, { status: 400 });

  const profileEmail =
    (typeof session.metadata?.profileEmail === "string" && session.metadata.profileEmail) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id) ||
    (typeof session.customer_email === "string" && session.customer_email) ||
    "";
  if (!profileEmail) return NextResponse.json({ error: "missing_profile_email" }, { status: 400 });

  const packId = typeof session.metadata?.packId === "string" ? session.metadata.packId : "unknown";
  const currency = typeof session.currency === "string" ? session.currency : "sar";
  const unitAmount = typeof session.amount_total === "number" && Number.isFinite(session.amount_total) ? Math.max(0, Math.floor(session.amount_total)) : 0;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const existingPurchase = await tx.purchase.findUnique({ where: { stripeSessionId: sessionId } });
      const existingProfile = await tx.gameProfile.findUnique({ where: { email: profileEmail } });
      const existingState =
        existingProfile && existingProfile.state && typeof existingProfile.state === "object" ? (existingProfile.state as Record<string, unknown>) : {};

      const existingCoinsRaw = existingState.coins;
      const existingCoins =
        typeof existingCoinsRaw === "number" && Number.isFinite(existingCoinsRaw) ? Math.max(0, Math.floor(existingCoinsRaw)) : 0;

      const existingEarnedRaw = existingState.coinsEarnedTotal;
      const existingEarned =
        typeof existingEarnedRaw === "number" && Number.isFinite(existingEarnedRaw) ? Math.max(0, Math.floor(existingEarnedRaw)) : 0;

      const existingPeakRaw = existingState.coinsPeak;
      const existingPeak =
        typeof existingPeakRaw === "number" && Number.isFinite(existingPeakRaw) ? Math.max(0, Math.floor(existingPeakRaw)) : existingCoins;

      const processedRaw = existingState.processedSessions;
      const processedSessions = Array.isArray(processedRaw) ? processedRaw.filter((x) => typeof x === "string") : [];

      if (existingPurchase || processedSessions.includes(sessionId)) {
        return { ok: true, coinsAdded: 0, totalCoins: existingCoins, alreadyProcessed: true };
      }

      if (!existingProfile) {
        await tx.gameProfile.create({
          data: {
            email: profileEmail,
            state: { coins: existingCoins, coinsEarnedTotal: existingEarned, coinsPeak: existingPeak, processedSessions, lastWriteAt: 0 },
          },
        });
      }

      try {
        await tx.purchase.create({
          data: {
            profileEmail,
            stripeSessionId: sessionId,
            packId,
            coins,
            currency,
            unitAmount,
            status: "paid",
          },
        });
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (code === "P2002") {
          return { ok: true, coinsAdded: 0, totalCoins: existingCoins, alreadyProcessed: true };
        }
        throw e;
      }

      const totalCoins = existingCoins + coins;
      const nextProcessed = processedSessions.concat(sessionId).slice(-50);
      const nextEarned = existingEarned + coins;
      const nextPeak = Math.max(existingPeak, totalCoins);

      const existingNameChangeRaw = existingState.nameChange;
      const existingNameChange =
        existingNameChangeRaw && typeof existingNameChangeRaw === "object" ? (existingNameChangeRaw as Record<string, unknown>) : {};
      const existingCreditsRaw = existingNameChange.credits;
      const existingCredits =
        typeof existingCreditsRaw === "number" && Number.isFinite(existingCreditsRaw)
          ? Math.max(0, Math.floor(existingCreditsRaw))
          : typeof existingCreditsRaw === "string"
            ? Math.max(0, Math.floor(parseInt(existingCreditsRaw, 10) || 0))
            : 0;
      const freeUsed = !!existingNameChange.freeUsed;

      const nextNameChange =
        nameChangeCredits > 0
          ? { freeUsed, credits: existingCredits + nameChangeCredits }
          : existingNameChangeRaw && typeof existingNameChangeRaw === "object"
            ? existingNameChangeRaw
            : { freeUsed, credits: existingCredits };

      const nextState = {
        ...existingState,
        coins: totalCoins,
        coinsEarnedTotal: nextEarned,
        coinsPeak: nextPeak,
        processedSessions: nextProcessed,
        nameChange: nextNameChange,
        lastWriteAt: Date.now(),
      };

      await tx.gameProfile.update({
        where: { email: profileEmail },
        data: { state: nextState },
      });

      return { ok: true, coinsAdded: coins, nameChangeCreditsAdded: nameChangeCredits, totalCoins, alreadyProcessed: false };
    });

    if (out && typeof out === "object" && !("error" in out)) {
      const alreadyProcessed = !!(out as { alreadyProcessed?: unknown }).alreadyProcessed;
      const coinsAdded = typeof (out as { coinsAdded?: unknown }).coinsAdded === "number" ? (out as { coinsAdded: number }).coinsAdded : 0;
      const nameCreditsAdded =
        typeof (out as { nameChangeCreditsAdded?: unknown }).nameChangeCreditsAdded === "number"
          ? (out as { nameChangeCreditsAdded: number }).nameChangeCreditsAdded
          : 0;
      if (!alreadyProcessed && (coinsAdded > 0 || nameCreditsAdded > 0)) {
        await notifyDiscord("audit", {
          title: "Purchase paid (Stripe webhook)",
          email: profileEmail,
          fields: [
            { name: "Pack", value: packId, inline: true },
            { name: "Coins", value: String(coinsAdded), inline: true },
            { name: "Name credits", value: String(nameCreditsAdded), inline: true },
            { name: "Amount", value: unitAmount ? `${(unitAmount / 100).toFixed(2)} ${currency.toUpperCase()}` : `0 ${currency.toUpperCase()}`, inline: true },
            { name: "Session", value: sessionId, inline: false },
          ],
        });
      }
    }
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

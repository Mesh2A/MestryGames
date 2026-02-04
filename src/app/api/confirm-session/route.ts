import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type StripeCheckoutSession = {
  payment_status?: string;
  currency?: string;
  amount_total?: number;
  metadata?: {
    coins?: string;
    nameChangeCredits?: string;
    packId?: string;
    profileEmail?: string;
  };
};

export async function GET(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("session_id") || "";
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const data = (await r.json().catch(() => ({}))) as StripeCheckoutSession;
  if (!r.ok || !data) return NextResponse.json({ error: "stripe_error", stripe: data }, { status: 502 });
  if (data.payment_status !== "paid") return NextResponse.json({ error: "not_paid" }, { status: 402 });

  const coinsStr = typeof data.metadata?.coins === "string" ? data.metadata.coins : "0";
  const coins = Math.max(0, Math.floor(parseInt(coinsStr, 10) || 0));
  const creditsStr = typeof data.metadata?.nameChangeCredits === "string" ? data.metadata.nameChangeCredits : "0";
  const nameChangeCredits = Math.max(0, Math.floor(parseInt(creditsStr, 10) || 0));
  if (!coins && !nameChangeCredits) return NextResponse.json({ error: "invalid_purchase" }, { status: 400 });

  const packId = typeof data.metadata?.packId === "string" ? data.metadata.packId : "unknown";
  const currency = typeof data.currency === "string" ? data.currency : "sar";
  const unitAmount = typeof data.amount_total === "number" && Number.isFinite(data.amount_total) ? Math.max(0, Math.floor(data.amount_total)) : 0;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const existingPurchase = await tx.purchase.findUnique({ where: { stripeSessionId: sessionId } });
      const existingProfile = await tx.gameProfile.findUnique({ where: { email } });
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
            email,
            state: { coins: existingCoins, coinsEarnedTotal: existingEarned, coinsPeak: existingPeak, processedSessions, lastWriteAt: 0 },
          },
        });
      }

      try {
        await tx.purchase.create({
          data: {
            profileEmail: email,
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
        where: { email },
        data: { state: nextState },
      });

      return {
        ok: true,
        coinsAdded: coins,
        nameChangeCreditsAdded: nameChangeCredits,
        totalCoins,
        totalNameChangeCredits: nameChangeCredits ? existingCredits + nameChangeCredits : existingCredits,
        alreadyProcessed: false,
      };
    });

    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

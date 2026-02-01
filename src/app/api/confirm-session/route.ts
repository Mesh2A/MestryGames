import { NextRequest, NextResponse } from "next/server";

type StripeCheckoutSession = {
  payment_status?: string;
  metadata?: {
    coins?: string;
  };
};

export async function GET(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

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
  if (!coins) return NextResponse.json({ error: "invalid_coins" }, { status: 400 });

  return NextResponse.json({ coins }, { status: 200 });
}

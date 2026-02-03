import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type CreateCheckoutBody = {
  packId?: unknown;
};

type StripeCreateSessionResponse = {
  url?: string;
};

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CreateCheckoutBody = {};
  try {
    body = (await req.json()) as CreateCheckoutBody;
  } catch {
    body = {};
  }

  const packs: Record<string, { title: string; priceSar: number; unitAmount: number; coins: number; nameChangeCredits: number }> = {
    pack_099: { title: "Coins pack 0.99 SAR", priceSar: 0.99, unitAmount: 99, coins: 12, nameChangeCredits: 0 },
    pack_299: { title: "Coins pack 2.99 SAR", priceSar: 2.99, unitAmount: 299, coins: 45, nameChangeCredits: 0 },
    pack_499: { title: "Coins pack 4.99 SAR", priceSar: 4.99, unitAmount: 499, coins: 80, nameChangeCredits: 0 },
    pack_999: { title: "Coins pack 9.99 SAR", priceSar: 9.99, unitAmount: 999, coins: 170, nameChangeCredits: 0 },
    pack_1999: { title: "Coins pack 19.99 SAR", priceSar: 19.99, unitAmount: 1999, coins: 400, nameChangeCredits: 0 },
    name_499: { title: "Name change", priceSar: 4.99, unitAmount: 499, coins: 0, nameChangeCredits: 1 },
  };

  const packId = typeof body.packId === "string" ? body.packId : "";
  const pack = packs[packId];
  if (!pack) return NextResponse.json({ error: "invalid_pack" }, { status: 400 });

  const origin = process.env.APP_ORIGIN || req.nextUrl.origin;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${origin}/game/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/game/index.html?checkout=cancelled`);
  form.set("line_items[0][price_data][currency]", "sar");
  form.set("line_items[0][price_data][product_data][name]", pack.title || `Coins pack ${pack.priceSar} SAR`);
  form.set("line_items[0][price_data][unit_amount]", String(pack.unitAmount));
  form.set("line_items[0][quantity]", "1");
  form.set("customer_email", email);
  form.set("client_reference_id", email);
  form.set("metadata[packId]", packId);
  form.set("metadata[coins]", String(pack.coins));
  form.set("metadata[nameChangeCredits]", String(pack.nameChangeCredits || 0));
  form.set("metadata[profileEmail]", email);

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = (await r.json().catch(() => ({}))) as StripeCreateSessionResponse;
  if (!r.ok || !data || !data.url) return NextResponse.json({ error: "stripe_error", stripe: data }, { status: 502 });

  return NextResponse.json({ url: data.url }, { status: 200 });
}

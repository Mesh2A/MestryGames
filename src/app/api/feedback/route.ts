import { authOptions } from "@/lib/auth";
import { notifyDiscord } from "@/lib/discord";
import { ensureGameProfile } from "@/lib/gameProfile";
import { consumeRateLimit } from "@/lib/rateLimit";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

function readIp(req: NextRequest) {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim() || "";
  return first || req.headers.get("x-real-ip") || "";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email : "";
  const ip = readIp(req);

  const rlKey = `feedback:${email || ip || "anon"}`;
  const rl = consumeRateLimit(rlKey, { limit: 6, windowMs: 10 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const messageRaw =
    body && typeof body === "object" && "message" in body && typeof (body as { message?: unknown }).message === "string"
      ? String((body as { message: string }).message)
      : "";
  const message = messageRaw.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (message.length < 3) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const pageRaw =
    body && typeof body === "object" && "page" in body && typeof (body as { page?: unknown }).page === "string"
      ? String((body as { page: string }).page).trim()
      : "";
  const page = pageRaw.slice(0, 200);

  let publicId = "";
  let displayName = "";
  if (email) {
    try {
      const profile = await ensureGameProfile(email);
      publicId = String(profile.publicId || "");
      displayName = readDisplayNameFromState(profile.state);
    } catch {
      publicId = "";
    }
  }

  await notifyDiscord("suggestions", {
    title: "Feedback",
    email: email || undefined,
    content: message,
    fields: [
      { name: "User ID", value: publicId || "—", inline: true },
      { name: "Name", value: displayName || "—", inline: true },
      { name: "Page", value: page || "—", inline: false },
    ],
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

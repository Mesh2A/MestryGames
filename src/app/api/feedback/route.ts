import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { consumeRateLimit } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function readIp(req: NextRequest) {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim() || "";
  return first || req.headers.get("x-real-ip") || "";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email : "";
  const ip = readIp(req);
  const userAgent = req.headers.get("user-agent") || "";

  const rlKeyIp = `support:ip:${ip || "anon"}`;
  const rlKeyEmail = `support:email:${email || "anon"}`;
  const rlIp = consumeRateLimit(rlKeyIp, { limit: 6, windowMs: 10 * 60_000 });
  const rlEmail = consumeRateLimit(rlKeyEmail, { limit: 4, windowMs: 10 * 60_000 });
  const rl = rlIp.ok && rlEmail.ok;
  if (!rl) return NextResponse.json({ error: "rate_limited", retryAfterMs: Math.max(rlIp.retryAfterMs, rlEmail.retryAfterMs) }, { status: 429 });

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
  if (message.length < 10) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const pageRaw =
    body && typeof body === "object" && "page" in body && typeof (body as { page?: unknown }).page === "string"
      ? String((body as { page: string }).page).trim()
      : "";
  const page = pageRaw.slice(0, 200);

  let publicId = "";
  let username = "";
  if (email) {
    try {
      const profile = await ensureGameProfile(email);
      publicId = String(profile.publicId || "");
      username = typeof profile.username === "string" ? profile.username : "";
    } catch {
      publicId = "";
    }
  }

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Support request</h2>
      <p><strong>Username/User ID:</strong> ${username || publicId || "—"}</p>
      <p><strong>User email:</strong> ${email || "—"}</p>
      <p><strong>Message:</strong><br/>${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      <p><strong>Timestamp (UTC):</strong> ${new Date().toISOString()}</p>
      <p><strong>IP:</strong> ${ip || "—"}</p>
      <p><strong>User-Agent:</strong> ${userAgent || "—"}</p>
      <p><strong>Page URL:</strong> ${page || "—"}</p>
    </div>
  `;

  const sent = await sendEmail("support@mestrygames.com", "Support request", html);
  if (!sent.ok) console.error("brevo_send_failed", { kind: "support" });

  return NextResponse.json({ ok: true }, { status: 200 });
}

import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { consumeRateLimit } from "@/lib/rateLimit";
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

function normalizeEmail(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readIp(req: NextRequest) {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim() || "";
  return first || req.headers.get("x-real-ip") || "";
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const emailRaw = body && typeof body === "object" && "email" in body ? (body as { email?: unknown }).email : "";
  const email = normalizeEmail(typeof emailRaw === "string" ? emailRaw : "");

  try {
    await ensureDbReady();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const ip = readIp(req);
  const rlIp = consumeRateLimit(`pwreset:ip:${ip || "anon"}`, { limit: 6, windowMs: 15 * 60_000 });
  const rlEmail = consumeRateLimit(`pwreset:email:${email || "anon"}`, { limit: 3, windowMs: 15 * 60_000 });
  if (!rlIp.ok || !rlEmail.ok) return NextResponse.json({ ok: true }, { status: 200 });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: true }, { status: 200 });

  const profile = await prisma.gameProfile.findFirst({
    where: { OR: [{ email }, { contactEmail: email }] },
    select: { email: true, passwordHash: true, state: true },
  });

  if (!profile || !profile.passwordHash) return NextResponse.json({ ok: true }, { status: 200 });

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await prisma.resetToken.create({
    data: { email: profile.email, tokenHash, expiresAt, used: false },
  });

  const url = new URL("https://mestrygames.com/reset-password");
  url.searchParams.set("token", token);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Reset your MestryGames password</h2>
      <p>Click the button below to reset your password.</p>
      <p>
        <a href="${url.toString()}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;padding:12px 18px;background:#5865f2;color:#fff;border-radius:8px;text-decoration:none;">
          Reset Password
        </a>
      </p>
      <p>This link expires in 15 minutes.</p>
    </div>
  `;

  const sent = await sendEmail(profile.email, "Reset your MestryGames password", html);
  if (!sent.ok) console.error("brevo_send_failed", { kind: "reset" });
  return NextResponse.json({ ok: true }, { status: 200 });
}

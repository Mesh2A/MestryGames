import { authOptions } from "@/lib/auth";
import { notifyDiscord } from "@/lib/discord";
import { ensureDbReady } from "@/lib/ensureDb";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rateLimit";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

function readDisplayNameFromState(state: unknown) {
  if (!state || typeof state !== "object") return "";
  const v = (state as Record<string, unknown>).displayName;
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email : "";
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = consumeRateLimit(`report_player:${email}`, { limit: 4, windowMs: 10 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const targetIdRaw =
    body && typeof body === "object" && "targetId" in body && typeof (body as { targetId?: unknown }).targetId === "string"
      ? String((body as { targetId: string }).targetId).trim()
      : "";
  const targetId = /^[a-z0-9]{2,32}$/i.test(targetIdRaw) ? targetIdRaw : "";
  if (!targetId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const reasonRaw =
    body && typeof body === "object" && "reason" in body && typeof (body as { reason?: unknown }).reason === "string"
      ? String((body as { reason: string }).reason)
      : "";
  const reason = reasonRaw.replace(/\s+/g, " ").trim().slice(0, 120);

  const detailsRaw =
    body && typeof body === "object" && "details" in body && typeof (body as { details?: unknown }).details === "string"
      ? String((body as { details: string }).details)
      : "";
  const details = detailsRaw.replace(/\s+/g, " ").trim().slice(0, 1200);

  const id = `r_${randomUUID()}`;

  let reporterId = "";
  let reporterName = "";
  try {
    const reporter = await ensureGameProfile(email);
    reporterId = String(reporter.publicId || "");
    reporterName = readDisplayNameFromState(reporter.state);
  } catch {
    reporterId = "";
  }

  let targetName = "";
  try {
    const target = await prisma.gameProfile.findUnique({ where: { publicId: targetId }, select: { state: true } });
    targetName = readDisplayNameFromState(target?.state);
  } catch {
    targetName = "";
  }

  await notifyDiscord("reports", {
    title: "Player report",
    email,
    fields: [
      { name: "Report ID", value: id, inline: true },
      { name: "Reporter ID", value: reporterId || "—", inline: true },
      { name: "Reporter name", value: reporterName || "—", inline: true },
      { name: "Target ID", value: targetId, inline: true },
      { name: "Target name", value: targetName || "—", inline: true },
      { name: "Reason", value: reason || "—", inline: false },
      { name: "Details", value: details || "—", inline: false },
    ],
  });

  try {
    await ensureDbReady();
    await prisma.$executeRaw`
      INSERT INTO "PlayerReport" ("id","reporterEmail","reporterId","targetId","reason","details","createdAt")
      VALUES (${id}, ${email.toLowerCase()}, ${reporterId || null}, ${targetId}, ${reason || null}, ${details || null}, NOW())
      ON CONFLICT ("id") DO NOTHING
    `;
  } catch {}

  return NextResponse.json({ ok: true, id }, { status: 200 });
}

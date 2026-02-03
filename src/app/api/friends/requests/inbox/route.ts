import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { firstNameFromEmail } from "@/lib/profile";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const sinceMs = Math.max(0, Math.floor(parseInt(String(sinceRaw || "0"), 10) || 0));
  const since = sinceMs ? new Date(sinceMs) : null;

  try {
    await ensureGameProfile(email);
    const rows = await prisma.friendRequest.findMany({
      where: { toEmail: email, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, fromEmail: true, createdAt: true },
    });

    const fromEmails = Array.from(new Set(rows.map((r) => r.fromEmail)));
    const profiles = fromEmails.length
      ? await prisma.gameProfile.findMany({ where: { email: { in: fromEmails } }, select: { email: true, publicId: true, state: true } })
      : [];

    const map = new Map(
      profiles.map((p) => {
        const displayName =
          p.state && typeof p.state === "object" && typeof (p.state as Record<string, unknown>).displayName === "string"
            ? String((p.state as Record<string, unknown>).displayName).trim()
            : "";
        const name = displayName ? displayName.split(/\s+/).filter(Boolean)[0] || displayName : firstNameFromEmail(p.email);
        return [p.email, { id: p.publicId || "", name }];
      })
    );

    const requests = rows.map((r) => ({
      requestId: r.id,
      fromId: map.get(r.fromEmail)?.id || "",
      fromName: map.get(r.fromEmail)?.name || firstNameFromEmail(r.fromEmail),
      createdAt: r.createdAt.getTime(),
    }));

    return NextResponse.json({ requests }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


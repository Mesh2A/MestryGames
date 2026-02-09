import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function safeStatus(v: unknown) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "new" || s === "reviewing" || s === "action_taken") return s;
  return "";
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const takeRaw = String(req.nextUrl.searchParams.get("take") || "").trim();
  const take = Math.max(1, Math.min(200, Math.floor(parseInt(takeRaw || "100", 10) || 100)));
  const status = safeStatus(req.nextUrl.searchParams.get("status") || "");
  const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<
      {
        id: string;
        reporterEmail: string;
        reporterId: string | null;
        targetId: string;
        reason: string | null;
        details: string | null;
        status: string;
        matchId: string | null;
        chatId: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT "id","reporterEmail","reporterId","targetId","reason","details","status","matchId","chatId","createdAt"
      FROM "PlayerReport"
      ORDER BY "createdAt" DESC
      LIMIT 200
    `;

    const filtered = rows
      .filter((r) => (status ? String(r.status || "").toLowerCase() === status : true))
      .filter((r) => {
        if (!q) return true;
        const s = `${r.id} ${r.reporterEmail} ${r.reporterId || ""} ${r.targetId} ${r.reason || ""} ${r.details || ""} ${r.status || ""} ${
          r.matchId || ""
        } ${r.chatId || ""}`.toLowerCase();
        return s.includes(q);
      })
      .slice(0, take);

    return NextResponse.json(
      {
        ok: true,
        items: filtered.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const id = body && typeof body === "object" && "id" in body ? String((body as { id?: unknown }).id || "").trim() : "";
  const status = safeStatus(body && typeof body === "object" && "status" in body ? (body as { status?: unknown }).status : "");
  const actionRaw = body && typeof body === "object" && "action" in body ? (body as { action?: unknown }).action : "";
  const action = typeof actionRaw === "string" ? actionRaw.replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (!id || !status) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    await ensureDbReady();
    await prisma.$executeRaw`
      UPDATE "PlayerReport"
      SET "status" = ${status}
      WHERE "id" = ${id}
    `;
    await logAdminAction(String(adminEmail), "report_update", { id, status, action });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


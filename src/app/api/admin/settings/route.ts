import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { logAdminAction } from "@/lib/adminLog";
import { ensureDbReady } from "@/lib/ensureDb";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function intFromUnknown(x: unknown) {
  if (typeof x === "number" && Number.isFinite(x)) return Math.floor(x);
  if (typeof x === "string") return Math.floor(parseInt(x, 10) || 0);
  return 0;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(adminEmail)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    await ensureDbReady();
    const rows = await prisma.$queryRaw<
      {
        onlineEnabled: boolean;
        turnMs: number;
        reportAlertThreshold: number;
        maintenanceMode: boolean;
        profanityFilterEnabled: boolean;
      }[]
    >`
      SELECT "onlineEnabled","turnMs","reportAlertThreshold","maintenanceMode","profanityFilterEnabled"
      FROM "AppConfig"
      WHERE "id" = 'global'
      LIMIT 1
    `;
    const row = rows && rows[0] ? rows[0] : null;
    return NextResponse.json(
      {
        ok: true,
        onlineEnabled: row ? !!row.onlineEnabled : true,
        turnMs: row ? Math.max(5_000, Math.min(180_000, intFromUnknown(row.turnMs))) : 30_000,
        reportAlertThreshold: row ? Math.max(1, Math.min(50, intFromUnknown(row.reportAlertThreshold))) : 5,
        maintenanceMode: row ? !!row.maintenanceMode : false,
        profanityFilterEnabled: row ? !!row.profanityFilterEnabled : false,
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

  const onlineEnabled =
    body && typeof body === "object" && "onlineEnabled" in body && typeof (body as { onlineEnabled?: unknown }).onlineEnabled === "boolean"
      ? (body as { onlineEnabled: boolean }).onlineEnabled
      : null;

  const turnMsRaw = body && typeof body === "object" && "turnMs" in body ? (body as { turnMs?: unknown }).turnMs : null;
  const reportAlertThresholdRaw =
    body && typeof body === "object" && "reportAlertThreshold" in body ? (body as { reportAlertThreshold?: unknown }).reportAlertThreshold : null;
  const maintenanceModeRaw =
    body && typeof body === "object" && "maintenanceMode" in body ? (body as { maintenanceMode?: unknown }).maintenanceMode : null;
  const profanityFilterEnabledRaw =
    body && typeof body === "object" && "profanityFilterEnabled" in body ? (body as { profanityFilterEnabled?: unknown }).profanityFilterEnabled : null;

  const patch: Record<string, unknown> = {};
  if (onlineEnabled !== null) patch.onlineEnabled = onlineEnabled;
  if (turnMsRaw !== null) patch.turnMs = Math.max(5_000, Math.min(180_000, intFromUnknown(turnMsRaw)));
  if (reportAlertThresholdRaw !== null) patch.reportAlertThreshold = Math.max(1, Math.min(50, intFromUnknown(reportAlertThresholdRaw)));
  if (typeof maintenanceModeRaw === "boolean") patch.maintenanceMode = maintenanceModeRaw;
  if (typeof profanityFilterEnabledRaw === "boolean") patch.profanityFilterEnabled = profanityFilterEnabledRaw;

  if (!Object.keys(patch).length) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    await ensureDbReady();
    await prisma.$executeRaw`
      UPDATE "AppConfig"
      SET
        "onlineEnabled" = COALESCE(${patch.onlineEnabled ?? null}::boolean, "onlineEnabled"),
        "turnMs" = COALESCE(${patch.turnMs ?? null}::integer, "turnMs"),
        "reportAlertThreshold" = COALESCE(${patch.reportAlertThreshold ?? null}::integer, "reportAlertThreshold"),
        "maintenanceMode" = COALESCE(${patch.maintenanceMode ?? null}::boolean, "maintenanceMode"),
        "profanityFilterEnabled" = COALESCE(${patch.profanityFilterEnabled ?? null}::boolean, "profanityFilterEnabled"),
        "updatedAt" = NOW()
      WHERE "id" = 'global'
    `;
    await logAdminAction(String(adminEmail), "settings_update", patch);
    return GET();
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


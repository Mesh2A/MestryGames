import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const requestId =
    body && typeof body === "object" && "requestId" in body && typeof (body as { requestId?: unknown }).requestId === "string"
      ? (body as { requestId: string }).requestId
      : "";
  const action =
    body && typeof body === "object" && "action" in body && typeof (body as { action?: unknown }).action === "string"
      ? (body as { action: string }).action
      : "";

  if (!requestId) return NextResponse.json({ error: "missing_request" }, { status: 400 });
  if (action !== "accept" && action !== "decline") return NextResponse.json({ error: "bad_action" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const reqRow = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!reqRow || reqRow.toEmail !== email) return NextResponse.json({ ok: true, missing: true }, { status: 200 });

    if (action === "decline") {
      await prisma.$transaction(async (tx) => {
        await tx.friendRequest.delete({ where: { id: requestId } });
        await tx.friendRequestEvent.create({ data: { fromEmail: email, toEmail: reqRow.fromEmail, action: "declined" } });
      });
      return NextResponse.json({ ok: true, declined: true }, { status: 200 });
    }

    const [aEmail, bEmail] = sortPair(email, reqRow.fromEmail);
    await prisma.$transaction(async (tx) => {
      await tx.friendRequest.delete({ where: { id: requestId } });
      await tx.friendRequest.deleteMany({ where: { fromEmail: email, toEmail: reqRow.fromEmail } });
      try {
        await tx.friendship.create({ data: { aEmail, bEmail } });
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (code !== "P2002") throw e;
      }
      await tx.friendRequestEvent.create({ data: { fromEmail: email, toEmail: reqRow.fromEmail, action: "accepted" } });
    });

    return NextResponse.json({ ok: true, accepted: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


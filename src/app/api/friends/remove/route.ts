import { authOptions } from "@/lib/auth";
import { ensureGameProfile } from "@/lib/gameProfile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

function sortPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = (req.nextUrl.searchParams.get("id") || "").trim().toUpperCase();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    await ensureGameProfile(email);
    const target = await prisma.gameProfile.findUnique({ where: { publicId: id } });
    if (!target) return NextResponse.json({ ok: true, missing: true }, { status: 200 });

    const [aEmail, bEmail] = sortPair(email, target.email);

    await prisma.$transaction(async (tx) => {
      await tx.friendship.deleteMany({ where: { aEmail, bEmail } });
      await tx.friendGift.deleteMany({
        where: {
          OR: [
            { fromEmail: email, toEmail: target.email },
            { fromEmail: target.email, toEmail: email },
          ],
        },
      });
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
}


import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function normalizeUsername(username: string) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const usernameRaw = searchParams.get("username") || "";
  const emailRaw = searchParams.get("email") || "";

  const username = normalizeUsername(usernameRaw);
  const email = String(emailRaw || "")
    .trim()
    .toLowerCase();

  const out: { usernameAvailable: boolean | null; emailAvailable: boolean | null } = {
    usernameAvailable: null,
    emailAvailable: null,
  };

  try {
    if (username) {
      const owner = await prisma.gameProfile.findFirst({ where: { username }, select: { id: true } });
      out.usernameAvailable = !owner;
    }

    if (email) {
      const owner = await prisma.gameProfile.findFirst({
        where: { OR: [{ email }, { contactEmail: email }] },
        select: { id: true },
      });
      out.emailAvailable = !owner;
    }

    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

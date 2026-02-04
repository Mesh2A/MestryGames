import { getOnlineEnabled } from "@/lib/onlineConfig";
import { NextResponse } from "next/server";

export async function GET() {
  const onlineEnabled = await getOnlineEnabled();
  return NextResponse.json({ onlineEnabled }, { status: 200, headers: { "Cache-Control": "no-store" } });
}


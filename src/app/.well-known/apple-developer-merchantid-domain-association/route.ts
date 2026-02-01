import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const content = process.env.APPLE_PAY_DOMAIN_ASSOCIATION || "";
  if (!content) return new NextResponse("not_configured", { status: 503 });

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}


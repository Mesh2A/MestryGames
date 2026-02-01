import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const plain = process.env.APPLE_PAY_DOMAIN_ASSOCIATION || "";
  const b64 = process.env.APPLE_PAY_DOMAIN_ASSOCIATION_B64 || "";
  const content = b64 ? Buffer.from(b64, "base64").toString("utf8") : plain;
  if (!content) return new NextResponse("not_configured", { status: 503 });

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

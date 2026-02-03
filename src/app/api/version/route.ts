import { NextResponse } from "next/server";

export async function GET() {
  const payload = {
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || "",
    commitRef: process.env.VERCEL_GIT_COMMIT_REF || "",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "",
    environment: process.env.VERCEL_ENV || "",
    buildId: process.env.VERCEL_BUILD_ID || "",
    region: process.env.VERCEL_REGION || "",
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store" } });
}

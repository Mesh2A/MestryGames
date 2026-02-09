import { authOptions } from "@/lib/auth";
import { getActiveBan } from "@/lib/ban";
import AuthButtons from "@/components/AuthButtons";
import BannedScreen from "@/components/BannedScreen";
import { getServerSession } from "next-auth/next";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || "";
  const ban = email ? await getActiveBan(email) : null;

  const name = session?.user?.name || "";
  const firstName = String(name).trim().split(/\s+/).filter(Boolean)[0] || "";
  const vercelId = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "";
  const buildId = vercelId ? String(vercelId).slice(0, 12) : "dev";
  const src = firstName
    ? `/game/index.html?fn=${encodeURIComponent(firstName)}&v=${encodeURIComponent(buildId)}`
    : `/game/index.html?v=${encodeURIComponent(buildId)}`;

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 700px at 20% 0%, rgba(56, 189, 248, 0.18), transparent 62%), radial-gradient(1100px 760px at 84% 10%, rgba(167, 139, 250, 0.14), transparent 64%), #070912",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!session ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 16,
            transform: "translateX(-50%)",
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            color: "#fff",
            fontSize: 12,
            lineHeight: 1.6,
            maxWidth: "min(520px, 90vw)",
            pointerEvents: "auto",
            zIndex: 5,
            display: "grid",
            gap: 10,
            textAlign: "center",
          }}
        >
          <div>سجّل دخولك لحفظ تقدمك وعمليات الشراء على حسابك.</div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <AuthButtons />
          </div>
        </div>
      ) : null}
      {ban ? (
        <BannedScreen bannedUntilMs={ban.bannedUntilMs} reason={ban.reason} />
      ) : (
        <iframe
          title="game"
          src={src}
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            display: "block",
          }}
          allow="clipboard-write; fullscreen"
        />
      )}
    </div>
  );
}

import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

export default async function PlayPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  const name = session.user?.name || "";
  const firstName = String(name).trim().split(/\s+/).filter(Boolean)[0] || "";
  const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || "dev";
  const src = firstName
    ? `/game/index.html?fn=${encodeURIComponent(firstName)}&v=${encodeURIComponent(buildId)}`
    : `/game/index.html?v=${encodeURIComponent(buildId)}`;

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100vh",
        background: "#0b1020",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {firstName ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 16,
            transform: "translateX(-50%)",
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(13, 18, 34, 0.6)",
            color: "#fff",
            fontSize: 12,
            maxWidth: "min(360px, 72vw)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {firstName}
        </div>
      ) : null}
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
    </div>
  );
}

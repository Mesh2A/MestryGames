import { authOptions } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

export default async function PlayPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100vh",
        background: "#0b1020",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "fixed", top: 12, left: 12, zIndex: 50 }}>
        <LogoutButton
          style={{
            height: 44,
            padding: "0 14px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.92)",
            fontWeight: 800,
            cursor: "pointer",
          }}
        />
      </div>
      <iframe
        title="game"
        src="/game/index.html"
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

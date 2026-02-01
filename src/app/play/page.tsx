import { authOptions } from "@/lib/auth";
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

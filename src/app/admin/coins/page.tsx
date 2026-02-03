import AuthButtons from "@/components/AuthButtons";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";

export default async function AdminCoinsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || "";

  if (!session) {
    return (
      <div style={pageStyle}>
        <h1 style={h1Style}>لوحة الإدارة</h1>
        <div style={cardStyle}>سجّل دخولك للوصول للوحة الإدارة.</div>
        <AuthButtons />
      </div>
    );
  }

  if (!isAdminEmail(email)) {
    return (
      <div style={pageStyle}>
        <h1 style={h1Style}>لوحة الإدارة</h1>
        <div style={cardStyle}>غير مصرح.</div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>لوحة الإدارة</h1>
      <div style={cardStyle}>اضف ADMIN_EMAIL في Vercel واكتب ايميلك فقط.</div>
      <AdminUsersPanel />
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "22px 16px",
  background: "#0b1020",
  color: "#fff",
  display: "grid",
  alignContent: "start",
  justifyItems: "center",
  gap: 12,
};

const h1Style: React.CSSProperties = {
  fontSize: 20,
  margin: 0,
};

const cardStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(13, 18, 34, 0.65)",
  color: "#fff",
  lineHeight: 1.6,
  maxWidth: 560,
  width: "100%",
};

import AuthButtons from "@/components/AuthButtons";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import styles from "./page.module.css";

export default async function AdminCoinsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || "";

  if (!session) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>MestRyPanel</h1>
            <div className={styles.sub}>لوحة الإدارة</div>
          </div>
        </div>
        <div className={styles.notice}>سجّل دخولك للوصول للوحة الإدارة.</div>
        <div className={styles.shell}>
          <AuthButtons />
        </div>
      </div>
    );
  }

  if (!isAdminEmail(email)) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>MestRyPanel</h1>
            <div className={styles.sub}>لوحة الإدارة</div>
          </div>
        </div>
        <div className={styles.notice}>غير مصرح.</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>MestRyPanel</h1>
          <div className={styles.sub}>إدارة اللاعبين والأونلاين</div>
        </div>
      </div>
      <div className={styles.shell}>
        <AdminUsersPanel />
      </div>
    </div>
  );
}

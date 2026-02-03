import styles from "./page.module.css";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import AuthButtons from "@/components/AuthButtons";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/play");
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.brand}>فتح الاقفال</div>
          <div className={styles.desc}>تسجيل الدخول يحفظ تقدمك وعمليات الشراء على حسابك.</div>
          <div className={styles.actions}>
            <AuthButtons />
          </div>
        </div>
      </main>
    </div>
  );
}

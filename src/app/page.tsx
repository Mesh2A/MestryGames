import styles from "./page.module.css";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import AuthButtons from "@/components/AuthButtons";

export default async function Home() {
  const session = await getServerSession(authOptions);
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.brand}>فتح الاقفال</div>
          <div className={styles.desc}>تسجيل الدخول يحفظ تقدمك وعمليات الشراء على حسابك.</div>
          <div className={styles.actions}>
            {session ? <Link className={styles.primary} href="/play">ابدأ اللعب</Link> : <AuthButtons />}
          </div>
          <div className={styles.meta}>
            {session?.user?.email ? <span>مسجل: {session.user.email}</span> : <span>غير مسجل</span>}
          </div>
        </div>
      </main>
    </div>
  );
}

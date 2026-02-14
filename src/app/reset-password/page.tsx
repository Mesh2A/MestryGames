"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <div className={styles.card}>
            <div className={styles.title}>إعادة تعيين كلمة المرور</div>
            <div className={styles.desc}>جاري التحميل...</div>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = useMemo(() => String(params.get("token") || "").trim(), [params]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.title}>إعادة تعيين كلمة المرور</div>
        <div className={styles.desc}>أدخل كلمة مرور جديدة لحسابك.</div>
        {!token ? <div className={styles.error}>الرابط غير صالح.</div> : null}
        {done ? <div className={styles.success}>تم تحديث كلمة المرور. سجّل دخولك الآن.</div> : null}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!token) return;
            if (busy) return;
            setError(null);
            if (password.length < 8) {
              setError("الباسوورد لازم 8 أحرف أو أكثر.");
              return;
            }
            if (password !== confirm) {
              setError("كلمة المرور غير متطابقة.");
              return;
            }
            setBusy(true);
            try {
              const r = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
              });
              const data = (await r.json().catch(() => null)) as { error?: string } | null;
              if (!r.ok) {
                const code = data && typeof data.error === "string" ? data.error : "server_error";
                if (code === "invalid_token") setError("الرابط غير صالح أو انتهى.");
                else if (code === "bad_password") setError("الباسوورد لازم 8 أحرف أو أكثر.");
                else setError("تعذر تحديث كلمة المرور.");
                return;
              }
              setDone(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>كلمة المرور الجديدة</span>
            <input className={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>تأكيد كلمة المرور</span>
            <input className={styles.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button className={styles.btn} type="submit" disabled={busy || !token || done}>
            حفظ كلمة المرور
          </button>
        </form>
      </div>
    </div>
  );
}

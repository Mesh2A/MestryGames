"use client";

import { getProviders, signIn, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import styles from "./AuthButtons.module.css";

type Provider = {
  id: string;
  name: string;
};

export default function AuthButtons() {
  const { data: session, status } = useSession();
  const [providers, setProviders] = useState<Record<string, Provider> | null>(null);

  useEffect(() => {
    getProviders()
      .then((p) => setProviders(p as Record<string, Provider> | null))
      .catch(() => setProviders(null));
  }, []);

  const providerList = useMemo(() => {
    const list = providers ? Object.values(providers) : [];
    return list.filter((p) => p.id === "google" || p.id === "apple");
  }, [providers]);

  if (status === "loading") return null;

  if (session) return null;

  if (!providers) {
    return (
      <button
        type="button"
        onClick={() => signIn("google")}
        className={`${styles.btn} ${styles.google}`}
      >
        تسجيل الدخول
      </button>
    );
  }

  if (providerList.length === 0) {
    return (
      <button
        type="button"
        disabled
        className={styles.btn}
      >
        فعّل Google/Apple في .env
      </button>
    );
  }

  return (
    <div className={styles.stack}>
      {providerList.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => signIn(p.id, { callbackUrl: "/play" })}
          className={`${styles.btn} ${p.id === "apple" ? styles.apple : styles.google}`}
        >
          <span className={styles.icon} aria-hidden="true">
            {p.id === "apple" ? <AppleIcon /> : <GoogleIcon />}
          </span>
          <span>{p.id === "apple" ? "تسجيل دخول Apple" : "تسجيل دخول Google"}</span>
        </button>
      ))}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M23.49 12.27c0-.82-.07-1.6-.2-2.36H12v4.48h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.75Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3c-1.08.73-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.95H1.26v3.09A12 12 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.26a12 12 0 0 0 0 10.8l4.01-3.09Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.74c1.76 0 3.34.61 4.58 1.79l3.43-3.43C17.94 1.07 15.24 0 12 0 7.31 0 3.25 2.69 1.26 6.6l4.01 3.09C6.22 6.85 8.87 4.74 12 4.74Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M16.52 13.34c.02 2.19 1.94 2.92 1.96 2.93-.02.05-.31 1.07-1.03 2.12-.62.9-1.27 1.8-2.29 1.82-1 .02-1.32-.6-2.47-.6-1.14 0-1.5.58-2.45.62-1 .04-1.77-1-2.4-1.89-1.3-1.86-2.29-5.27-.96-7.57.66-1.14 1.85-1.86 3.14-1.88.98-.02 1.9.65 2.47.65.57 0 1.65-.8 2.78-.68.47.02 1.8.19 2.65 1.43-.07.04-1.58.92-1.56 2.75ZM14.7 6.99c.52-.63.86-1.5.76-2.37-.75.03-1.67.5-2.21 1.13-.49.56-.91 1.46-.8 2.32.84.07 1.72-.42 2.25-1.08Z"
      />
    </svg>
  );
}

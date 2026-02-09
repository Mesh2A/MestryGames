"use client";

import { useEffect, useMemo, useState } from "react";
import LogoutButton from "@/components/LogoutButton";
import styles from "./BannedScreen.module.css";

type Props = {
  bannedUntilMs: number;
  reason?: string;
};

function clampMs(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function formatRemaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d} يوم ${h} ساعة`;
  if (h > 0) return `${h} ساعة ${m} دقيقة`;
  if (m > 0) return `${m} دقيقة ${ss} ثانية`;
  return `${ss} ثانية`;
}

export default function BannedScreen({ bannedUntilMs, reason }: Props) {
  const until = useMemo(() => clampMs(bannedUntilMs), [bannedUntilMs]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const leftMs = Math.max(0, until - now);
  const done = leftMs <= 0;
  const endText = until ? new Date(until).toLocaleString() : "";
  const cleanReason = String(reason || "").trim();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>تم حظر حسابك مؤقتًا</h1>

        <div className={styles.body}>
          لا يمكنك الدخول للعبة خلال فترة الحظر.
          {cleanReason ? ` السبب: ${cleanReason}` : ""}
        </div>

        <div className={styles.timer}>
          <div className={styles.timerLabel}>{done ? "انتهى الحظر" : "الوقت المتبقي"}</div>
          <div className={styles.timerValue}>{done ? "0 ثانية" : formatRemaining(leftMs)}</div>
          {endText ? <div className={styles.small}>ينتهي في: {endText}</div> : null}
        </div>

        <div className={styles.actions}>
          <LogoutButton className={styles.btn} />
        </div>
      </div>
    </div>
  );
}


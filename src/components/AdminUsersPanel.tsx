"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import styles from "./AdminUsersPanel.module.css";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
  photo?: string;
  coins: number;
  stats: { streak: number; wins: number; unlocked: number; completed: number };
  createdAt: string;
  updatedAt: string;
};

type UsersResponse = { users: AdminUser[] } | { error: string };

export default function AdminUsersPanel() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [op, setOp] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const [onlineEnabled, setOnlineEnabled] = useState<boolean | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);

  const parsedAmount = useMemo(() => Math.max(0, Math.floor(parseInt(amount || "0", 10) || 0)), [amount]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/online", { method: "GET" });
        const data = (await r.json().catch(() => null)) as unknown;
        if (!mounted) return;
        if (!r.ok || !data || typeof data !== "object") {
          setOnlineEnabled(null);
          return;
        }
        const enabledRaw = (data as Record<string, unknown>).onlineEnabled;
        if (typeof enabledRaw !== "boolean") {
          setOnlineEnabled(null);
          return;
        }
        setOnlineEnabled(enabledRaw);
      } catch {
        if (mounted) setOnlineEnabled(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function toggleOnline() {
    setMessage("");
    if (onlineBusy) return;
    if (onlineEnabled === null) {
      setMessage("تعذر قراءة حالة الأونلاين.");
      return;
    }
    const next = !onlineEnabled;
    setOnlineBusy(true);
    try {
      const r = await fetch("/api/admin/online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlineEnabled: next }),
      });
      const data = (await r.json().catch(() => null)) as { onlineEnabled?: boolean; error?: string } | null;
      if (!r.ok || !data || typeof data.onlineEnabled !== "boolean") {
        setMessage((data && data.error) || "فشل تحديث حالة الأونلاين.");
        return;
      }
      setOnlineEnabled(data.onlineEnabled);
      setMessage(data.onlineEnabled ? "تم تشغيل الأونلاين." : "تم إيقاف الأونلاين.");
    } finally {
      setOnlineBusy(false);
    }
  }

  async function load() {
    setMessage("");
    setSelected(null);
    setLoading(true);
    try {
      const url = `/api/admin/users?q=${encodeURIComponent(q.trim())}&take=200`;
      const r = await fetch(url, { method: "GET" });
      const data = (await r.json().catch(() => null)) as UsersResponse | null;
      if (!r.ok || !data || "error" in data) {
        setUsers(null);
        setMessage((data && "error" in data && data.error) || "فشل جلب اللاعبين.");
        return;
      }
      setUsers(data.users);
    } finally {
      setLoading(false);
    }
  }

  async function updateCoins() {
    setMessage("");
    if (!selected) {
      setMessage("اختر لاعب.");
      return;
    }
    if (!parsedAmount) {
      setMessage("اكتب كمية كوينز صحيحة.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/admin/coins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selected.email, op, amount: parsedAmount }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string; totalCoins?: number; previousCoins?: number } | null;
      if (!r.ok || !data || data.error || typeof data.totalCoins !== "number") {
        setMessage((data && data.error) || "فشل تحديث الكوينز.");
        return;
      }

      setMessage(`تم. ${op === "add" ? "أضفنا" : "ضبطنا"} الكوينز: ${(data.previousCoins ?? selected.coins) as number} → ${data.totalCoins}`);
      setSelected({ ...selected, coins: data.totalCoins });
      setUsers((prev) => (prev ? prev.map((u) => (u.email === selected.email ? { ...u, coins: data.totalCoins as number } : u)) : prev));
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser() {
    setMessage("");
    if (!selected) {
      setMessage("اختر لاعب.");
      return;
    }
    const ok = window.confirm(`حذف اللاعب نهائيًا؟\n${selected.email}`);
    if (!ok) return;

    setLoading(true);
    try {
      const r = await fetch(`/api/admin/users?email=${encodeURIComponent(selected.email)}`, { method: "DELETE" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || data.error) {
        setMessage((data && data.error) || "فشل الحذف.");
        return;
      }
      setMessage("تم حذف اللاعب.");
      setUsers((prev) => (prev ? prev.filter((u) => u.email !== selected.email) : prev));
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.sectionTitle}>تحدي اونلاين</div>
        <button
          type="button"
          onClick={toggleOnline}
          disabled={onlineBusy || onlineEnabled === null}
          className={`${styles.btn} ${styles.btnChip}`}
          style={{
            background:
              onlineEnabled === null ? "rgba(255,255,255,0.06)" : onlineEnabled ? "rgba(34, 197, 94, 0.25)" : "rgba(148, 163, 184, 0.14)",
            borderColor:
              onlineEnabled === null ? "rgba(255,255,255,0.16)" : onlineEnabled ? "rgba(34, 197, 94, 0.5)" : "rgba(148, 163, 184, 0.30)",
            minWidth: 110,
          }}
        >
          {onlineEnabled === null ? "غير متاح" : onlineEnabled ? "تشغيل" : "إيقاف"}
        </button>
      </div>

      <div className={styles.inputRow}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="MestRy@Admin" className={styles.input} />
        <button type="button" onClick={load} disabled={loading} className={styles.btn} style={{ minWidth: 120 }}>
          MestRyGo
        </button>
      </div>

      <div className={styles.listHead}>
        <div className={styles.listTitle}>اللاعبين</div>
        <div className={styles.listMeta}>{users ? `${users.length} لاعب` : ""}</div>
      </div>

      <div className={styles.list}>
        {users && users.length ? (
          users.map((u) => (
            <button
              type="button"
              key={u.email}
              onClick={() => setSelected(u)}
              disabled={loading}
              className={`${styles.btn} ${styles.rowBtn} ${selected?.email === u.email ? styles.rowBtnActive : ""}`}
            >
              <div className={styles.rowTop}>
                <div className={styles.rowName}>{u.firstName}</div>
                <div className={styles.rowCoins}>{u.coins} كوينز</div>
              </div>
              <div className={styles.rowLine}>
                {u.email}
                {u.id ? ` — ID: ${u.id}` : ""}
              </div>
              <div className={styles.rowLine} style={{ opacity: 0.72 }}>
                فتح: {u.stats?.unlocked ?? 1} — فوز: {u.stats?.wins ?? 0} — ستريك: {u.stats?.streak ?? 0}
              </div>
            </button>
          ))
        ) : (
          <div className={styles.small} style={{ opacity: 0.8 }}>
            اضغط “MestRyGo” لعرض اللاعبين.
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <div className={styles.sectionTitle}>تحكم</div>

        {selected ? (
          <div className={styles.selected} style={{ marginTop: 10 }}>
            <div className={styles.selectedHeader}>
              <div className={styles.avatar}>
                {selected.photo ? (
                  <Image alt="" src={selected.photo} width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} unoptimized />
                ) : (
                  (selected.firstName || "P").slice(0, 1).toUpperCase()
                )}
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <div className={styles.selectedName}>
                  {selected.firstName}
                  {selected.id ? ` — ${selected.id}` : ""}
                </div>
                <div className={styles.small}>{selected.email}</div>
              </div>
            </div>
            <div className={styles.small}>{selected.displayName ? `الاسم: ${selected.displayName}` : "الاسم: —"}</div>
            <div className={styles.small}>
              تسجيل أول مرة: {new Date(selected.createdAt).toLocaleString()}
            </div>
            <div className={styles.small}>
              آخر تحديث: {new Date(selected.updatedAt).toLocaleString()}
            </div>
            <div className={styles.small}>الكوينز الحالية: {selected.coins}</div>
            <div className={styles.small}>
              إحصائيات: فتح {selected.stats?.unlocked ?? 1} — مكتملة {selected.stats?.completed ?? 0} — فوز {selected.stats?.wins ?? 0} — ستريك {selected.stats?.streak ?? 0}
            </div>

            <div className={styles.actionsRow}>
              <button
                type="button"
                onClick={() => setOp("add")}
                disabled={loading}
                className={`${styles.btn} ${styles.btnChip} ${op === "add" ? styles.btnChipActive : ""}`}
              >
                إضافة
              </button>
              <button
                type="button"
                onClick={() => setOp("set")}
                disabled={loading}
                className={`${styles.btn} ${styles.btnChip} ${op === "set" ? styles.btnChipActive : ""}`}
              >
                ضبط
              </button>
            </div>

            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              placeholder="مثال: 100"
              className={styles.input}
              style={{ width: "100%", minWidth: 0 }}
            />

            <div className={styles.actionsRow}>
              <button type="button" onClick={updateCoins} disabled={loading} className={`${styles.btn} ${styles.btnPrimary}`}>
                تطبيق
              </button>
              <button type="button" onClick={deleteUser} disabled={loading} className={`${styles.btn} ${styles.btnDanger}`}>
                حذف اللاعب
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.small} style={{ marginTop: 10, opacity: 0.8 }}>
            اختر لاعب من القائمة.
          </div>
        )}
      </div>

      {message ? <div className={styles.panel}>{message}</div> : null}
    </div>
  );
}

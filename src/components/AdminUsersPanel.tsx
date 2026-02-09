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
  reportsReceived?: number;
  banned?: boolean;
  bannedUntilMs?: number;
  banReason?: string;
  createdAt: string;
  updatedAt: string;
};

type UsersResponse = { users: AdminUser[] } | { error: string };

export default function AdminUsersPanel() {
  const [tab, setTab] = useState<"users" | "online">("users");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [detailTab, setDetailTab] = useState<"coins" | "ban">("coins");
  const [op, setOp] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const [onlineEnabled, setOnlineEnabled] = useState<boolean | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [banBusy, setBanBusy] = useState(false);
  const [banDurationMs, setBanDurationMs] = useState("300000");
  const [banReason, setBanReason] = useState("");

  const parsedAmount = useMemo(() => Math.max(0, Math.floor(parseInt(amount || "0", 10) || 0)), [amount]);

  const now = Date.now();

  const banOptions = useMemo(
    () => [
      { label: "5 دقائق", ms: 5 * 60_000 },
      { label: "10 دقائق", ms: 10 * 60_000 },
      { label: "30 دقيقة", ms: 30 * 60_000 },
      { label: "ساعة", ms: 60 * 60_000 },
      { label: "6 ساعات", ms: 6 * 60 * 60_000 },
      { label: "12 ساعة", ms: 12 * 60 * 60_000 },
      { label: "يوم", ms: 24 * 60 * 60_000 },
      { label: "3 أيام", ms: 3 * 24 * 60 * 60_000 },
      { label: "7 أيام", ms: 7 * 24 * 60 * 60_000 },
      { label: "30 يوم", ms: 30 * 24 * 60 * 60_000 },
      { label: "3 شهور", ms: 90 * 24 * 60 * 60_000 },
    ],
    []
  );

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

  function fmtRemaining(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}ي ${h}س`;
    if (h > 0) return `${h}س ${m}د`;
    return `${m}د`;
  }

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
    setDetailTab("coins");
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

  async function applyBan() {
    setMessage("");
    if (!selected) {
      setMessage("اختر لاعب.");
      return;
    }
    if (banBusy) return;
    const duration = Math.max(0, Math.floor(parseInt(banDurationMs || "0", 10) || 0));
    if (!duration) {
      setMessage("اختر مدة باند.");
      return;
    }

    setBanBusy(true);
    try {
      const r = await fetch("/api/admin/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selected.email, durationMs: duration, reason: banReason }),
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; bannedUntilMs?: number; reason?: string } | null;
      if (!r.ok || !data || !data.ok || typeof data.bannedUntilMs !== "number") {
        setMessage((data && data.error) || "فشل تطبيق الباند.");
        return;
      }
      const next = { ...selected, banned: data.bannedUntilMs > Date.now(), bannedUntilMs: data.bannedUntilMs, banReason: String(data.reason || "") };
      setSelected(next);
      setUsers((prev) => (prev ? prev.map((u) => (u.email === selected.email ? { ...u, ...next } : u)) : prev));
      setMessage("تم تطبيق الباند.");
    } finally {
      setBanBusy(false);
    }
  }

  async function clearBan() {
    setMessage("");
    if (!selected) {
      setMessage("اختر لاعب.");
      return;
    }
    if (banBusy) return;
    setBanBusy(true);
    try {
      const r = await fetch(`/api/admin/ban?email=${encodeURIComponent(selected.email)}`, { method: "DELETE" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) {
        setMessage((data && data.error) || "فشل فك الباند.");
        return;
      }
      const next = { ...selected, banned: false, bannedUntilMs: 0, banReason: "" };
      setSelected(next);
      setUsers((prev) => (prev ? prev.map((u) => (u.email === selected.email ? { ...u, ...next } : u)) : prev));
      setMessage("تم فك الباند.");
    } finally {
      setBanBusy(false);
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
        <div className={styles.sectionTitle}>لوحة التحكم</div>
        <div className={styles.tabs}>
          <button type="button" onClick={() => setTab("users")} className={`${styles.tabBtn} ${tab === "users" ? styles.tabBtnActive : ""}`}>
            اللاعبين
          </button>
          <button type="button" onClick={() => setTab("online")} className={`${styles.tabBtn} ${tab === "online" ? styles.tabBtnActive : ""}`}>
            الأونلاين
          </button>
        </div>
      </div>

      {tab === "online" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>تحدي اونلاين</div>
          <div className={styles.actionsRow} style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={toggleOnline}
              disabled={onlineBusy || onlineEnabled === null}
              className={`${styles.btn} ${styles.btnChip}`}
              style={{
                background:
                  onlineEnabled === null
                    ? "rgba(255,255,255,0.06)"
                    : onlineEnabled
                      ? "rgba(34, 197, 94, 0.25)"
                      : "rgba(148, 163, 184, 0.14)",
                borderColor:
                  onlineEnabled === null
                    ? "rgba(255,255,255,0.16)"
                    : onlineEnabled
                      ? "rgba(34, 197, 94, 0.5)"
                      : "rgba(148, 163, 184, 0.30)",
                minWidth: 130,
              }}
            >
              {onlineEnabled === null ? "غير متاح" : onlineEnabled ? "تشغيل" : "إيقاف"}
            </button>
          </div>
          <div className={styles.small} style={{ marginTop: 10, opacity: 0.82 }}>
            تحكم سريع لتشغيل/إيقاف تحدي الأونلاين من السيرفر.
          </div>
        </div>
      ) : (
        <>
          <div className={styles.inputRow}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالإيميل" className={styles.input} />
            <button type="button" onClick={load} disabled={loading} className={styles.btn} style={{ minWidth: 140 }}>
              جلب اللاعبين
            </button>
          </div>

          <div className={styles.layout}>
            <div className={styles.col}>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>اللاعبين</div>
                <div className={styles.listMeta}>{users ? `${users.length} لاعب` : ""}</div>
              </div>

              <div className={styles.list}>
                {users && users.length ? (
                  users.map((u) => {
                    const reports = Math.max(0, Math.floor(u.reportsReceived || 0));
                    const banned = !!(u.bannedUntilMs && u.bannedUntilMs > now);
                    return (
                      <button
                        type="button"
                        key={u.email}
                        onClick={() => {
                          setSelected(u);
                          setDetailTab("coins");
                          setBanReason(u.banReason || "");
                        }}
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
                        <div className={styles.rowMetaRow}>
                          <span className={styles.badge}>{reports} بلاغ</span>
                          {banned ? <span className={`${styles.badge} ${styles.badgeDanger}`}>مبند</span> : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className={styles.small} style={{ opacity: 0.8 }}>
                    اضغط “جلب اللاعبين” لعرض اللاعبين.
                  </div>
                )}
              </div>
            </div>

            <div className={styles.col}>
              <div className={styles.panel}>
                <div className={styles.sectionTitle}>تحكم</div>

                {selected ? (
                  <div className={styles.selected} style={{ marginTop: 10 }}>
                    <div className={styles.selectedHeader}>
                      <div className={styles.avatar}>
                        {selected.photo ? (
                          <Image
                            alt=""
                            src={selected.photo}
                            width={44}
                            height={44}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            unoptimized
                          />
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
                    <div className={styles.small}>بلاغات مستلمة: {Math.max(0, Math.floor(selected.reportsReceived || 0))}</div>
                    <div className={styles.small}>تسجيل أول مرة: {new Date(selected.createdAt).toLocaleString()}</div>
                    <div className={styles.small}>آخر تحديث: {new Date(selected.updatedAt).toLocaleString()}</div>

                    <div className={styles.tabsSub}>
                      <button
                        type="button"
                        onClick={() => setDetailTab("coins")}
                        className={`${styles.tabBtn} ${detailTab === "coins" ? styles.tabBtnActive : ""}`}
                      >
                        الكوينز
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailTab("ban")}
                        className={`${styles.tabBtn} ${detailTab === "ban" ? styles.tabBtnActive : ""}`}
                      >
                        الباند
                      </button>
                    </div>

                    {detailTab === "coins" ? (
                      <>
                        <div className={styles.small}>الكوينز الحالية: {selected.coins}</div>
                        <div className={styles.small}>
                          إحصائيات: فتح {selected.stats?.unlocked ?? 1} — مكتملة {selected.stats?.completed ?? 0} — فوز {selected.stats?.wins ?? 0} — ستريك{" "}
                          {selected.stats?.streak ?? 0}
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
                      </>
                    ) : (
                      <>
                        {selected.bannedUntilMs && selected.bannedUntilMs > now ? (
                          <div className={styles.small} style={{ opacity: 0.92 }}>
                            مبند حتى: {new Date(selected.bannedUntilMs).toLocaleString()} ({fmtRemaining(selected.bannedUntilMs - now)})
                          </div>
                        ) : (
                          <div className={styles.small} style={{ opacity: 0.82 }}>
                            غير مبند حالياً.
                          </div>
                        )}

                        <select value={banDurationMs} onChange={(e) => setBanDurationMs(e.target.value)} className={styles.select}>
                          {banOptions.map((o) => (
                            <option key={o.ms} value={String(o.ms)}>
                              {o.label}
                            </option>
                          ))}
                        </select>

                        <input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="سبب الباند (اختياري)" className={styles.input} />

                        <div className={styles.actionsRow}>
                          <button type="button" onClick={applyBan} disabled={banBusy || loading} className={`${styles.btn} ${styles.btnDanger}`}>
                            تطبيق باند
                          </button>
                          <button type="button" onClick={clearBan} disabled={banBusy || loading} className={`${styles.btn}`}>
                            فك الباند
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={styles.small} style={{ marginTop: 10, opacity: 0.8 }}>
                    اختر لاعب من القائمة.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {message ? <div className={styles.panel}>{message}</div> : null}
    </div>
  );
}

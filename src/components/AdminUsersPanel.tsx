"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  banCount?: number;
  banned?: boolean;
  bannedUntilMs?: number;
  banReason?: string;
  createdAt: string;
  updatedAt: string;
};

type UsersResponse = { users: AdminUser[] } | { error: string };

export default function AdminUsersPanel() {
  const [tab, setTab] = useState<
    "account" | "players" | "matches" | "reports" | "stats" | "security" | "settings" | "logs"
  >("players");
  const [summary, setSummary] = useState<{
    usersTotal: number;
    reportsTotal: number;
    reports24h: number;
    bansActive: number;
    onlineEnabled: boolean;
    lastReportAt: string;
  } | null>(null);
  const [me, setMe] = useState<
    | {
        email: string;
        loginEmail: string;
        id: string;
        displayName: string;
        firstName: string;
        createdAt: string;
      }
    | null
  >(null);
  const [logs, setLogs] = useState<
    { id: string; adminEmail: string; action: string; details: unknown; createdAt: string }[] | null
  >(null);
  const [logsQ, setLogsQ] = useState("");
  const [reports, setReports] = useState<
    {
      id: string;
      reporterEmail: string;
      reporterId: string | null;
      targetId: string;
      reason: string | null;
      details: string | null;
      status: string;
      matchId: string | null;
      chatId: string | null;
      createdAt: string;
    }[] | null
  >(null);
  const [reportsStatus, setReportsStatus] = useState<"" | "new" | "reviewing" | "action_taken">("");
  const [matches, setMatches] = useState<
    | {
        queueWaiting: number;
        roomWaiting: number;
        ongoing: { id: string; mode: string; fee: number; codeLen: number; aEmail: string; bEmail: string; createdAt: string; updatedAt: string }[];
        recentEnded: {
          id: string;
          mode: string;
          fee: number;
          codeLen: number;
          aEmail: string;
          bEmail: string;
          winnerEmail: string | null;
          endedAt: string | null;
          createdAt: string;
        }[];
      }
    | null
  >(null);
  const [settings, setSettings] = useState<
    | { onlineEnabled: boolean; turnMs: number; reportAlertThreshold: number; maintenanceMode: boolean; profanityFilterEnabled: boolean }
    | null
  >(null);
  const [banHistory, setBanHistory] = useState<
    { id: string; adminEmail: string; action: string; details: unknown; createdAt: string }[] | null
  >(null);
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
  const [warnNote, setWarnNote] = useState("");
  const [usersFilter, setUsersFilter] = useState<"all" | "banned" | "reported">("all");
  const [usersSort, setUsersSort] = useState<"updated" | "coins">("updated");

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

  const loadSummary = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/summary", { method: "GET" });
      const data = (await r.json().catch(() => null)) as
        | {
            ok?: boolean;
            usersTotal?: number;
            reportsTotal?: number;
            reports24h?: number;
            bansActive?: number;
            onlineEnabled?: boolean;
            lastReportAt?: string;
          }
        | { error?: string }
        | null;
      if (!r.ok || !data || typeof data !== "object" || !("ok" in data) || !data.ok) return;
      setSummary({
        usersTotal: typeof data.usersTotal === "number" ? data.usersTotal : 0,
        reportsTotal: typeof data.reportsTotal === "number" ? data.reportsTotal : 0,
        reports24h: typeof data.reports24h === "number" ? data.reports24h : 0,
        bansActive: typeof data.bansActive === "number" ? data.bansActive : 0,
        onlineEnabled: data.onlineEnabled === true,
        lastReportAt: typeof data.lastReportAt === "string" ? data.lastReportAt : "",
      });
    } catch {}
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { method: "GET" });
      const data = (await r.json().catch(() => null)) as
        | { error?: string }
        | { email?: string; loginEmail?: string; id?: string; displayName?: string; firstName?: string; createdAt?: string }
        | null;
      if (!r.ok || !data || typeof data !== "object" || ("error" in data && data.error)) return;
      setMe({
        email: String((data as { email?: unknown }).email || ""),
        loginEmail: String((data as { loginEmail?: unknown }).loginEmail || ""),
        id: String((data as { id?: unknown }).id || ""),
        displayName: String((data as { displayName?: unknown }).displayName || ""),
        firstName: String((data as { firstName?: unknown }).firstName || ""),
        createdAt: String((data as { createdAt?: unknown }).createdAt || ""),
      });
    } catch {}
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const url = `/api/admin/logs?take=100&q=${encodeURIComponent(logsQ.trim())}`;
      const r = await fetch(url, { method: "GET" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; items?: unknown; error?: string } | null;
      if (!r.ok || !data || !data.ok || !Array.isArray(data.items)) return;
      setLogs(
        data.items
          .filter((x) => x && typeof x === "object")
          .map((x) => x as { id: string; adminEmail: string; action: string; details: unknown; createdAt: string })
      );
    } catch {}
  }, [logsQ]);

  const loadReports = useCallback(async () => {
    try {
      const url = `/api/admin/reports?take=120&status=${encodeURIComponent(reportsStatus)}`;
      const r = await fetch(url, { method: "GET" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; items?: unknown; error?: string } | null;
      if (!r.ok || !data || !data.ok || !Array.isArray(data.items)) return;
      setReports(data.items.filter((x) => x && typeof x === "object") as typeof reports);
    } catch {}
  }, [reportsStatus]);

  async function updateReportStatus(id: string, status: "new" | "reviewing" | "action_taken") {
    setMessage("");
    try {
      const r = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) {
        setMessage((data && data.error) || "فشل تحديث البلاغ.");
        return;
      }
      setReports((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, status } : x)) : prev));
    } catch {
      setMessage("فشل تحديث البلاغ.");
    }
  }

  const loadMatches = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/matches?take=60", { method: "GET" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) return;
      setMatches(data as typeof matches);
    } catch {}
  }, []);

  async function endMatch(matchId: string) {
    const ok = window.confirm(`إنهاء المباراة يدويًا؟\n${matchId}`);
    if (!ok) return;
    setMessage("");
    try {
      const r = await fetch("/api/admin/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", matchId }),
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) {
        setMessage((data && data.error) || "فشل إنهاء المباراة.");
        return;
      }
      loadMatches();
      setMessage("تم إنهاء المباراة.");
    } catch {
      setMessage("فشل إنهاء المباراة.");
    }
  }

  const loadSettings = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/settings", { method: "GET" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) return;
      setSettings(data as typeof settings);
      if (typeof (data as { onlineEnabled?: unknown }).onlineEnabled === "boolean") setOnlineEnabled((data as { onlineEnabled: boolean }).onlineEnabled);
    } catch {}
  }, []);

  async function saveSettings(patch: Partial<NonNullable<typeof settings>>) {
    setMessage("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) {
        setMessage((data && data.error) || "فشل حفظ الإعدادات.");
        return;
      }
      setSettings(data as typeof settings);
      setMessage("تم حفظ الإعدادات.");
    } catch {
      setMessage("فشل حفظ الإعدادات.");
    }
  }

  async function loadBanHistory(email: string) {
    try {
      const r = await fetch(`/api/admin/ban/history?email=${encodeURIComponent(email)}&take=50`, { method: "GET" });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; items?: unknown } | null;
      if (!r.ok || !data || !data.ok || !Array.isArray(data.items)) return;
      setBanHistory(data.items as typeof banHistory);
    } catch {}
  }

  async function warnUser() {
    setMessage("");
    if (!selected) {
      setMessage("اختر لاعب.");
      return;
    }
    const ok = window.confirm(`إرسال تحذير للاعب؟\n${selected.email}`);
    if (!ok) return;
    setLoading(true);
    try {
      const r = await fetch("/api/admin/warn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selected.email, note: warnNote }),
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !data || !data.ok) {
        setMessage((data && data.error) || "فشل التحذير.");
        return;
      }
      setMessage("تم إرسال التحذير.");
      setWarnNote("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "players" && tab !== "stats") return;
    loadSummary();
  }, [tab, loadSummary]);

  useEffect(() => {
    if (tab === "account") loadMe();
    if (tab === "logs") loadLogs();
    if (tab === "reports") loadReports();
    if (tab === "matches") loadMatches();
    if (tab === "settings") loadSettings();
  }, [tab, loadLogs, loadMatches, loadMe, loadReports, loadSettings]);

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
      loadSummary();
    } finally {
      setLoading(false);
    }
  }

  const visibleUsers = useMemo(() => {
    const base = Array.isArray(users) ? users.slice() : [];
    const filtered =
      usersFilter === "all"
        ? base
        : usersFilter === "banned"
          ? base.filter((u) => !!(u.bannedUntilMs && u.bannedUntilMs > now))
          : base.filter((u) => Math.max(0, Math.floor(u.reportsReceived || 0)) > 0);

    filtered.sort((a, b) => {
      if (usersSort === "coins") return Math.max(0, b.coins) - Math.max(0, a.coins);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return filtered;
  }, [users, usersFilter, usersSort, now]);

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
          <button type="button" onClick={() => setTab("account")} className={`${styles.tabBtn} ${tab === "account" ? styles.tabBtnActive : ""}`}>
            الحساب والصلاحيات
          </button>
          <button type="button" onClick={() => setTab("players")} className={`${styles.tabBtn} ${tab === "players" ? styles.tabBtnActive : ""}`}>
            إدارة اللاعبين
          </button>
          <button type="button" onClick={() => setTab("matches")} className={`${styles.tabBtn} ${tab === "matches" ? styles.tabBtnActive : ""}`}>
            إدارة المباريات
          </button>
          <button type="button" onClick={() => setTab("reports")} className={`${styles.tabBtn} ${tab === "reports" ? styles.tabBtnActive : ""}`}>
            البلاغات
          </button>
          <button type="button" onClick={() => setTab("stats")} className={`${styles.tabBtn} ${tab === "stats" ? styles.tabBtnActive : ""}`}>
            الإحصائيات
          </button>
          <button type="button" onClick={() => setTab("security")} className={`${styles.tabBtn} ${tab === "security" ? styles.tabBtnActive : ""}`}>
            الأمان
          </button>
          <button type="button" onClick={() => setTab("settings")} className={`${styles.tabBtn} ${tab === "settings" ? styles.tabBtnActive : ""}`}>
            الإعدادات
          </button>
          <button type="button" onClick={() => setTab("logs")} className={`${styles.tabBtn} ${tab === "logs" ? styles.tabBtnActive : ""}`}>
            اللوقز
          </button>
        </div>
      </div>

      {tab === "account" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>بيانات المستخدم</div>
          <div className={styles.small} style={{ marginTop: 10 }}>
            {me ? `ID: ${me.id || "—"} — الاسم: ${me.displayName || me.firstName || "—"} — الإيميل: ${me.email || "—"}` : "جاري التحميل..."}
          </div>
          <div className={styles.small} style={{ marginTop: 8, opacity: 0.82 }}>
            نوع الحساب: أدمن (Whitelist) — إدارة الصلاحيات حالياً عبر ENV (ADMIN_EMAIL/ADMIN_EMAILS)
          </div>
        </div>
      ) : tab === "players" ? (
        <>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>اللاعبين</div>
              <div className={styles.summaryValue}>{summary ? summary.usersTotal : "—"}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>بلاغات (24س)</div>
              <div className={styles.summaryValue}>{summary ? summary.reports24h : "—"}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>بلاغات (الإجمالي)</div>
              <div className={styles.summaryValue}>{summary ? summary.reportsTotal : "—"}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>المبندين الآن</div>
              <div className={styles.summaryValue}>{summary ? summary.bansActive : "—"}</div>
            </div>
            <button type="button" className={styles.summaryBtn} onClick={() => loadSummary()} disabled={loading}>
              تحديث الملخص
            </button>
          </div>

          <div className={styles.inputRow}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالإيميل أو ID" className={styles.input} />
            <button type="button" onClick={load} disabled={loading} className={styles.btn} style={{ minWidth: 140 }}>
              جلب اللاعبين
            </button>
          </div>

          <div className={styles.layout}>
            <div className={styles.col}>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>قائمة اللاعبين</div>
                <div className={styles.listMeta}>{users ? `${visibleUsers.length} لاعب` : ""}</div>
              </div>

              <div className={styles.filtersRow}>
                <div className={styles.filtersGroup}>
                  <button type="button" onClick={() => setUsersFilter("all")} className={`${styles.filterBtn} ${usersFilter === "all" ? styles.filterBtnActive : ""}`}>
                    الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsersFilter("reported")}
                    className={`${styles.filterBtn} ${usersFilter === "reported" ? styles.filterBtnActive : ""}`}
                  >
                    بلاغات
                  </button>
                  <button type="button" onClick={() => setUsersFilter("banned")} className={`${styles.filterBtn} ${usersFilter === "banned" ? styles.filterBtnActive : ""}`}>
                    مبندين
                  </button>
                </div>
                <div className={styles.filtersGroup}>
                  <button
                    type="button"
                    onClick={() => setUsersSort("updated")}
                    className={`${styles.filterBtn} ${usersSort === "updated" ? styles.filterBtnActive : ""}`}
                  >
                    أحدث
                  </button>
                  <button type="button" onClick={() => setUsersSort("coins")} className={`${styles.filterBtn} ${usersSort === "coins" ? styles.filterBtnActive : ""}`}>
                    كوينز
                  </button>
                </div>
              </div>

              <div className={styles.namesList}>
                {users && users.length ? (
                  visibleUsers.map((u) => {
                    const reportsCount = Math.max(0, Math.floor(u.reportsReceived || 0));
                    const banCount = Math.max(0, Math.floor(u.banCount || 0));
                    const banned = !!(u.bannedUntilMs && u.bannedUntilMs > now);
                    return (
                      <button
                        type="button"
                        key={u.email}
                        onClick={() => {
                          setSelected(u);
                          setDetailTab("coins");
                          setBanReason(u.banReason || "");
                          setBanHistory(null);
                          loadBanHistory(u.email);
                        }}
                        disabled={loading}
                        className={`${styles.btn} ${styles.rowBtn} ${selected?.email === u.email ? styles.rowBtnActive : ""}`}
                      >
                        <div className={styles.rowTop}>
                          <div className={styles.rowName}>{u.displayName || u.firstName || u.email}</div>
                          <div className={styles.rowCoins}>{u.coins} كوينز</div>
                        </div>
                        <div className={styles.rowLine}>
                          {u.email}
                          {u.id ? ` — ID: ${u.id}` : ""}
                        </div>
                        <div className={styles.rowMetaRow}>
                          <span className={styles.badge}>{reportsCount} بلاغ</span>
                          <span className={styles.badge}>{banCount} باند</span>
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
                <div className={styles.sectionTitle}>تحكم باللاعب</div>

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
                          {(selected.displayName || selected.firstName || "—") + (selected.id ? ` — ${selected.id}` : "")}
                        </div>
                        <div className={styles.small}>{selected.email}</div>
                      </div>
                    </div>

                    <div className={styles.small}>الكوينز: {selected.coins} — المباريات: {selected.stats?.wins ?? 0} فوز — بلاغات: {Math.max(0, Math.floor(selected.reportsReceived || 0))}</div>

                    <div className={styles.tabsSub}>
                      <button type="button" onClick={() => setDetailTab("coins")} className={`${styles.tabBtn} ${detailTab === "coins" ? styles.tabBtnActive : ""}`}>
                        الكوينز
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTab("ban");
                          loadBanHistory(selected.email);
                        }}
                        className={`${styles.tabBtn} ${detailTab === "ban" ? styles.tabBtnActive : ""}`}
                      >
                        الباند / التحذير
                      </button>
                    </div>

                    {detailTab === "coins" ? (
                      <>
                        <div className={styles.actionsRow}>
                          <button type="button" onClick={() => setOp("add")} disabled={loading} className={`${styles.btn} ${styles.btnChip} ${op === "add" ? styles.btnChipActive : ""}`}>
                            إضافة
                          </button>
                          <button type="button" onClick={() => setOp("set")} disabled={loading} className={`${styles.btn} ${styles.btnChip} ${op === "set" ? styles.btnChipActive : ""}`}>
                            ضبط
                          </button>
                        </div>

                        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="مثال: 100" className={styles.input} style={{ width: "100%", minWidth: 0 }} />

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
                            باند
                          </button>
                          <button type="button" onClick={clearBan} disabled={banBusy || loading} className={`${styles.btn}`}>
                            فك باند
                          </button>
                        </div>

                        <input value={warnNote} onChange={(e) => setWarnNote(e.target.value)} placeholder="سبب التحذير (اختياري)" className={styles.input} />
                        <div className={styles.actionsRow}>
                          <button type="button" onClick={warnUser} disabled={loading} className={`${styles.btn}`}>
                            تحذير
                          </button>
                        </div>

                        <div className={styles.sectionTitle} style={{ marginTop: 6 }}>
                          سجل الباند
                        </div>
                        <div className={styles.small} style={{ opacity: 0.82, whiteSpace: "pre-wrap" }}>
                          {banHistory
                            ? banHistory.length
                              ? banHistory.slice(0, 12).map((x) => `${new Date(x.createdAt).toLocaleString()} — ${x.action} — ${x.adminEmail}`).join("\n")
                              : "لا يوجد سجل."
                            : "جاري التحميل..."}
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
      ) : tab === "matches" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>المباريات الجارية والمعلقة</div>
          <div className={styles.actionsRow} style={{ marginTop: 10 }}>
            <button type="button" onClick={() => loadMatches()} className={styles.btn} disabled={loading}>
              تحديث
            </button>
          </div>
          <div className={styles.small} style={{ marginTop: 10 }}>
            {matches ? `الانتظار: ${matches.queueWaiting} — الغرف: ${matches.roomWaiting} — الجارية: ${matches.ongoing.length}` : "جاري التحميل..."}
          </div>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            الجارية
          </div>
          <div className={styles.list}>
            {matches && matches.ongoing.length ? (
              matches.ongoing.slice(0, 60).map((m) => (
                <div key={m.id} className={styles.listCard}>
                  <div className={styles.small} style={{ opacity: 0.95 }}>
                    {m.id} — {m.mode} — {m.fee} كوينز
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    {m.aEmail} vs {m.bEmail}
                  </div>
                  <div className={styles.actionsRow} style={{ marginTop: 8 }}>
                    <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => endMatch(m.id)}>
                      إنهاء مباراة يدوي
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.small} style={{ opacity: 0.8 }}>
                لا توجد مباريات جارية.
              </div>
            )}
          </div>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            آخر النتائج
          </div>
          <div className={styles.list}>
            {matches && matches.recentEnded && matches.recentEnded.length ? (
              matches.recentEnded.slice(0, 20).map((m) => (
                <div key={m.id} className={styles.listCard}>
                  <div className={styles.small} style={{ opacity: 0.95 }}>
                    {m.id} — {m.mode} — {m.fee} كوينز
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    {m.aEmail} vs {m.bEmail}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    الفائز: {m.winnerEmail || "—"} — انتهت: {m.endedAt ? new Date(m.endedAt).toLocaleString() : "—"}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.small} style={{ opacity: 0.8 }}>
                لا يوجد نتائج.
              </div>
            )}
          </div>
        </div>
      ) : tab === "reports" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>البلاغات</div>
          <div className={styles.actionsRow} style={{ marginTop: 10 }}>
            <select value={reportsStatus} onChange={(e) => setReportsStatus(e.target.value as typeof reportsStatus)} className={styles.select} style={{ maxWidth: 240 }}>
              <option value="">الكل</option>
              <option value="new">جديد</option>
              <option value="reviewing">تحت المراجعة</option>
              <option value="action_taken">تم الإجراء</option>
            </select>
            <button type="button" className={styles.btn} onClick={() => loadReports()} disabled={loading}>
              تحديث
            </button>
          </div>
          <div className={styles.list} style={{ marginTop: 10 }}>
            {reports && reports.length ? (
              reports.map((r) => (
                <div key={r.id} className={styles.listCard}>
                  <div className={styles.small} style={{ opacity: 0.95 }}>
                    {r.id} — {r.status}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    المبلغ: {r.reporterEmail} — الهدف: {r.targetId}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    السبب: {r.reason || "—"}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    التفاصيل: {r.details || "—"}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    مباراة: {r.matchId || "—"} — محادثة: {r.chatId || "—"}
                  </div>
                  <div className={styles.actionsRow} style={{ marginTop: 8 }}>
                    <button type="button" className={styles.btn} onClick={() => updateReportStatus(r.id, "new")}>
                      جديد
                    </button>
                    <button type="button" className={styles.btn} onClick={() => updateReportStatus(r.id, "reviewing")}>
                      تحت المراجعة
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => updateReportStatus(r.id, "action_taken")}>
                      تم الإجراء
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.small} style={{ opacity: 0.8 }}>
                لا توجد بلاغات حالياً.
              </div>
            )}
          </div>
        </div>
      ) : tab === "stats" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>الإحصائيات</div>
          <div className={styles.summaryGrid} style={{ marginTop: 10 }}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>عدد اللاعبين</div>
              <div className={styles.summaryValue}>{summary ? summary.usersTotal : "—"}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>بلاغات 24س</div>
              <div className={styles.summaryValue}>{summary ? summary.reports24h : "—"}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>المبندين الآن</div>
              <div className={styles.summaryValue}>{summary ? summary.bansActive : "—"}</div>
            </div>
            <button type="button" className={styles.summaryBtn} onClick={() => loadSummary()} disabled={loading}>
              تحديث
            </button>
          </div>
          <div className={styles.small} style={{ marginTop: 10, opacity: 0.82 }}>
            متوسط وقت البحث عن لاعب / معدل الفوز-الخسارة يحتاج تسجيل إضافي (سيتم ربطه لاحقاً).
          </div>
        </div>
      ) : tab === "security" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>الأمان ومكافحة الغش</div>
          <div className={styles.actionsRow} style={{ marginTop: 10 }}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setLogsQ("coins");
                loadLogs();
              }}
            >
              تتبع تغيّر الكوينز
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setLogsQ("ban");
                loadLogs();
              }}
            >
              لوق التعديلات المشبوهة
            </button>
          </div>
          <div className={styles.small} style={{ marginTop: 10, opacity: 0.82 }}>
            IP / Device ID وفلتر كلمات الشتم تحتاج بيانات من العميل، حالياً جاهزين في الإعدادات لتفعيل الفلتر.
          </div>
          <div className={styles.list} style={{ marginTop: 10 }}>
            {logs && logs.length ? (
              logs.slice(0, 60).map((l) => (
                <div key={l.id} className={styles.listCard}>
                  <div className={styles.small} style={{ opacity: 0.95 }}>
                    {l.action} — {l.adminEmail}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    {l.createdAt}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.small} style={{ opacity: 0.8 }}>
                حمّل اللوقز من الأزرار أعلاه.
              </div>
            )}
          </div>
        </div>
      ) : tab === "settings" ? (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>الإعدادات العامة</div>
          <div className={styles.actionsRow} style={{ marginTop: 10 }}>
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
                minWidth: 160,
              }}
            >
              {onlineEnabled === null ? "غير متاح" : onlineEnabled ? "الأونلاين: تشغيل" : "الأونلاين: إيقاف"}
            </button>
            <button type="button" className={styles.btn} onClick={() => loadSettings()} disabled={loading}>
              تحديث الإعدادات
            </button>
          </div>
          {settings ? (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <input
                className={styles.input}
                inputMode="numeric"
                value={String(settings.turnMs)}
                onChange={(e) => setSettings({ ...settings, turnMs: Math.max(5000, Math.min(180000, Math.floor(parseInt(e.target.value || "0", 10) || 0))) })}
                placeholder="وقت الدور بالمللي ثانية"
              />
              <input
                className={styles.input}
                inputMode="numeric"
                value={String(settings.reportAlertThreshold)}
                onChange={(e) =>
                  setSettings({ ...settings, reportAlertThreshold: Math.max(1, Math.min(50, Math.floor(parseInt(e.target.value || "0", 10) || 0))) })
                }
                placeholder="حد البلاغات قبل التنبيه"
              />
              <div className={styles.actionsRow}>
                <button type="button" className={`${styles.btn} ${settings.maintenanceMode ? styles.btnDanger : ""}`} onClick={() => setSettings({ ...settings, maintenanceMode: !settings.maintenanceMode })}>
                  وضع الصيانة: {settings.maintenanceMode ? "مفعل" : "متوقف"}
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setSettings({ ...settings, profanityFilterEnabled: !settings.profanityFilterEnabled })}
                >
                  فلتر الشتم: {settings.profanityFilterEnabled ? "مفعل" : "متوقف"}
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => saveSettings(settings)}>
                  حفظ
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.small} style={{ marginTop: 10, opacity: 0.82 }}>
              جاري تحميل الإعدادات...
            </div>
          )}
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>اللوقز</div>
          <div className={styles.inputRow} style={{ marginTop: 10 }}>
            <input value={logsQ} onChange={(e) => setLogsQ(e.target.value)} placeholder="بحث في اللوقز" className={styles.input} />
            <button type="button" className={styles.btn} onClick={() => loadLogs()} disabled={loading}>
              تحديث
            </button>
          </div>
          <div className={styles.list} style={{ marginTop: 10 }}>
            {logs && logs.length ? (
              logs.map((l) => (
                <div key={l.id} className={styles.listCard}>
                  <div className={styles.small} style={{ opacity: 0.95 }}>
                    {l.action} — {l.adminEmail}
                  </div>
                  <div className={styles.small} style={{ opacity: 0.82 }}>
                    {new Date(l.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.small} style={{ opacity: 0.8 }}>
                لا يوجد لوقز.
              </div>
            )}
          </div>
        </div>
      )}

      {message ? <div className={styles.panel}>{message}</div> : null}
    </div>
  );
}

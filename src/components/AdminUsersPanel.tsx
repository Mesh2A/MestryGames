"use client";

import { useMemo, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
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

  const parsedAmount = useMemo(() => Math.max(0, Math.floor(parseInt(amount || "0", 10) || 0)), [amount]);

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
    <div style={windowStyle}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="MestRy@Admin" style={inputStyle} />
        <button type="button" onClick={load} disabled={loading} style={{ ...btnStyle, minWidth: 120 }}>
          MestRyGo
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.92 }}>اللاعبين</div>
        <div style={{ fontSize: 11, opacity: 0.75 }}>{users ? `${users.length} لاعب` : ""}</div>
      </div>

      <div style={listStyle}>
        {users && users.length ? (
          users.map((u) => (
            <button
              type="button"
              key={u.email}
              onClick={() => setSelected(u)}
              disabled={loading}
              style={{
                ...rowBtnStyle,
                borderColor: selected?.email === u.email ? "rgba(37, 99, 235, 0.7)" : rowBtnStyle.borderColor,
                background: selected?.email === u.email ? "rgba(37, 99, 235, 0.15)" : rowBtnStyle.background,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 600 }}>{u.firstName}</div>
                <div style={{ opacity: 0.9, fontSize: 12 }}>{u.coins} كوينز</div>
              </div>
              <div style={{ fontSize: 11, opacity: 0.78, marginTop: 4 }}>
                {u.email}
                {u.id ? ` — ID: ${u.id}` : ""}
              </div>
              <div style={{ fontSize: 11, opacity: 0.72, marginTop: 4 }}>
                فتح: {u.stats?.unlocked ?? 1} — فوز: {u.stats?.wins ?? 0} — ستريك: {u.stats?.streak ?? 0}
              </div>
            </button>
          ))
        ) : (
          <div style={{ fontSize: 12, opacity: 0.8 }}>اضغط “MestRyGo” لعرض اللاعبين.</div>
        )}
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.92 }}>تحكم</div>

        {selected ? (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>
              {selected.firstName}
              {selected.id ? ` — ${selected.id}` : ""}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{selected.email}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{selected.displayName ? `الاسم: ${selected.displayName}` : "الاسم: —"}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              تسجيل أول مرة: {new Date(selected.createdAt).toLocaleString()}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              آخر تحديث: {new Date(selected.updatedAt).toLocaleString()}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>الكوينز الحالية: {selected.coins}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              إحصائيات: فتح {selected.stats?.unlocked ?? 1} — مكتملة {selected.stats?.completed ?? 0} — فوز {selected.stats?.wins ?? 0} — ستريك {selected.stats?.streak ?? 0}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setOp("add")} disabled={loading} style={chipStyle(op === "add")}>
                إضافة
              </button>
              <button type="button" onClick={() => setOp("set")} disabled={loading} style={chipStyle(op === "set")}>
                ضبط
              </button>
            </div>

            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="مثال: 100" style={inputStyle} />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={updateCoins} disabled={loading} style={{ ...btnStyle, background: "#2563eb" }}>
                تطبيق
              </button>
              <button type="button" onClick={deleteUser} disabled={loading} style={{ ...btnStyle, background: "rgba(220, 38, 38, 0.35)" }}>
                حذف اللاعب
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>اختر لاعب من القائمة.</div>
        )}
      </div>

      {message ? <div style={{ ...cardStyle, marginTop: 12 }}>{message}</div> : null}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  width: "100%",
};

const cardStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(13, 18, 34, 0.65)",
  color: "#fff",
  lineHeight: 1.6,
};

const windowStyle: React.CSSProperties = {
  ...cardStyle,
  width: "min(640px, 92vw)",
  padding: 16,
  borderRadius: 18,
};

const listStyle: React.CSSProperties = {
  marginTop: 10,
  display: "grid",
  gap: 8,
  maxHeight: 280,
  overflow: "auto",
  padding: 2,
};

const rowBtnStyle: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#fff",
  cursor: "pointer",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    ...btnStyle,
    padding: "8px 10px",
    background: active ? "rgba(37, 99, 235, 0.35)" : "rgba(255,255,255,0.06)",
    borderColor: active ? "rgba(37, 99, 235, 0.65)" : "rgba(255,255,255,0.16)",
  };
}

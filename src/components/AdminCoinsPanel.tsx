"use client";

import { useMemo, useState } from "react";

type CoinsLookupResponse = { email: string; exists: boolean; coins: number } | { error: string };
type CoinsUpdateResponse =
  | { ok: true; email: string; previousCoins: number; totalCoins: number; created: boolean }
  | { error: string };

export default function AdminCoinsPanel() {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [op, setOp] = useState<"add" | "set">("add");
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState<{ exists: boolean; coins: number } | null>(null);
  const [message, setMessage] = useState<string>("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const parsedAmount = useMemo(() => Math.max(0, Math.floor(parseInt(amount || "0", 10) || 0)), [amount]);

  async function refresh() {
    setMessage("");
    setLookup(null);
    if (!normalizedEmail) {
      setMessage("اكتب ايميل المستخدم.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch(`/api/admin/coins?email=${encodeURIComponent(normalizedEmail)}`, { method: "GET" });
      const data = (await r.json().catch(() => null)) as CoinsLookupResponse | null;
      if (!r.ok || !data || "error" in data) {
        setMessage((data && "error" in data && data.error) || "فشل جلب البيانات.");
        return;
      }
      setLookup({ exists: data.exists, coins: data.coins });
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setMessage("");
    if (!normalizedEmail) {
      setMessage("اكتب ايميل المستخدم.");
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
        body: JSON.stringify({ email: normalizedEmail, op, amount: parsedAmount }),
      });
      const data = (await r.json().catch(() => null)) as CoinsUpdateResponse | null;
      if (!r.ok || !data || "error" in data) {
        setMessage((data && "error" in data && data.error) || "فشل تحديث الكوينز.");
        return;
      }
      setLookup({ exists: true, coins: data.totalCoins });
      setMessage(`تم. ${op === "add" ? "أضفنا" : "ضبطنا"} الكوينز: ${data.previousCoins} → ${data.totalCoins}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, opacity: 0.9 }}>ايميل المستخدم</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, opacity: 0.9 }}>العملية</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setOp("add")}
            disabled={loading}
            style={chipStyle(op === "add")}
          >
            إضافة
          </button>
          <button
            type="button"
            onClick={() => setOp("set")}
            disabled={loading}
            style={chipStyle(op === "set")}
          >
            ضبط
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, opacity: 0.9 }}>الكمية</label>
        <input
          value={amount}
          inputMode="numeric"
          onChange={(e) => setAmount(e.target.value)}
          placeholder="مثال: 50"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={btnStyle}
        >
          جلب الرصيد
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          style={{ ...btnStyle, background: "#2563eb", borderColor: "rgba(255,255,255,0.18)" }}
        >
          تطبيق
        </button>
      </div>

      {lookup ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.9 }}>الحالة</div>
          <div style={{ marginTop: 6 }}>
            موجود: {lookup.exists ? "نعم" : "لا"} — الكوينز: {lookup.coins}
          </div>
        </div>
      ) : null}

      {message ? <div style={cardStyle}>{message}</div> : null}
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

function chipStyle(active: boolean): React.CSSProperties {
  return {
    ...btnStyle,
    padding: "8px 10px",
    background: active ? "rgba(37, 99, 235, 0.35)" : "rgba(255,255,255,0.06)",
    borderColor: active ? "rgba(37, 99, 235, 0.65)" : "rgba(255,255,255,0.16)",
  };
}

const cardStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(13, 18, 34, 0.65)",
  color: "#fff",
  lineHeight: 1.6,
};


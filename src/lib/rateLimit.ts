type Bucket = { resetAt: number; tokens: number };

function getStore() {
  const g = globalThis as unknown as { __rl_store__?: Map<string, Bucket> };
  if (!g.__rl_store__) g.__rl_store__ = new Map<string, Bucket>();
  return g.__rl_store__;
}

export function consumeRateLimit(key: string, opts: { limit: number; windowMs: number; nowMs?: number }) {
  const now = typeof opts.nowMs === "number" ? opts.nowMs : Date.now();
  const limit = Math.max(1, Math.floor(opts.limit));
  const windowMs = Math.max(250, Math.floor(opts.windowMs));

  const store = getStore();
  const cur = store.get(key);

  if (!cur || now >= cur.resetAt) {
    const next: Bucket = { resetAt: now + windowMs, tokens: limit - 1 };
    store.set(key, next);
    return { ok: true as const, remaining: next.tokens, resetAt: next.resetAt, retryAfterMs: 0 };
  }

  if (cur.tokens <= 0) {
    const retryAfterMs = Math.max(0, cur.resetAt - now);
    return { ok: false as const, remaining: 0, resetAt: cur.resetAt, retryAfterMs };
  }

  cur.tokens -= 1;
  store.set(key, cur);
  return { ok: true as const, remaining: cur.tokens, resetAt: cur.resetAt, retryAfterMs: 0 };
}


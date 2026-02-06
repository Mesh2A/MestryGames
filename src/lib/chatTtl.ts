export function pruneChatState(state: Record<string, unknown>, nowMs: number) {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  let changed = false;

  const inboxRaw = state.chatInbox;
  const inbox = Array.isArray(inboxRaw) ? inboxRaw : [];
  const nextInbox = inbox.filter((m) => {
    if (!m || typeof m !== "object") return false;
    const t = (m as Record<string, unknown>).createdAt;
    return typeof t === "number" && Number.isFinite(t) && t >= cutoff;
  });
  if (nextInbox.length !== inbox.length) changed = true;

  const threadsRaw = state.chatThreads;
  const threadsObj = threadsRaw && typeof threadsRaw === "object" ? (threadsRaw as Record<string, unknown>) : {};
  const nextThreads: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(threadsObj)) {
    const arr = Array.isArray(v) ? v : [];
    const kept = arr.filter((m) => {
      if (!m || typeof m !== "object") return false;
      const t = (m as Record<string, unknown>).createdAt;
      return typeof t === "number" && Number.isFinite(t) && t >= cutoff;
    });
    if (kept.length) nextThreads[k] = kept;
    if (kept.length !== arr.length) changed = true;
  }

  if (!changed) return { changed: false as const, next: state };
  return { changed: true as const, next: { ...state, chatInbox: nextInbox, chatThreads: nextThreads } };
}


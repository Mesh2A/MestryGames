import { randomBytes } from "crypto";

export function randomEventId() {
  return `e_${randomBytes(8).toString("hex")}`;
}

export function logOnlineEvent(payload: {
  eventType: string;
  userId?: string;
  matchId?: string | null;
  connectionId?: string;
  status?: string;
  reason?: string;
  details?: Record<string, unknown>;
}) {
  const entry = {
    id: randomEventId(),
    t: Date.now(),
    eventType: payload.eventType,
    userId: payload.userId || "",
    matchId: payload.matchId || null,
    connectionId: payload.connectionId || "",
    status: payload.status || "",
    reason: payload.reason || "",
    details: payload.details || {},
  };
  try {
    console.log(JSON.stringify({ scope: "online", ...entry }));
  } catch {}
}

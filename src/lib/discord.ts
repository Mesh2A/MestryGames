type DiscordField = { name: string; value: string; inline?: boolean };
type DiscordKind = "signup" | "signin" | "purchases" | "suggestions" | "errors" | "reports" | "audit" | "support";

function truncate(input: string, max: number) {
  const s = String(input ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function maskEmail(email: string) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at <= 0) return truncate(s, 64);
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const localMasked = local.length <= 2 ? `${local[0] || "*"}*` : `${local.slice(0, 1)}***${local.slice(-1)}`;
  return truncate(`${localMasked}@${domain}`, 80);
}

function pickWebhookUrl(kind: DiscordKind) {
  const byKind =
    kind === "signup"
      ? process.env.DISCORD_SIGNUP_WEBHOOK_URL
      : kind === "signin"
        ? process.env.DISCORD_SIGNIN_WEBHOOK_URL
        : kind === "purchases"
          ? process.env.DISCORD_PURCHASES_WEBHOOK_URL
        : kind === "suggestions"
          ? process.env.DISCORD_SUGGESTIONS_WEBHOOK_URL || process.env.DISCORD_FEEDBACK_WEBHOOK_URL
          : kind === "errors"
            ? process.env.DISCORD_ERRORS_WEBHOOK_URL
            : kind === "reports"
              ? process.env.DISCORD_REPORTS_WEBHOOK_URL
              : kind === "support"
                ? process.env.DISCORD_SUPPORT_WEBHOOK_URL
                : process.env.DISCORD_AUDIT_WEBHOOK_URL;
  return String(byKind || process.env.DISCORD_WEBHOOK_URL || "").trim();
}

async function postWebhook(webhookUrl: string, payload: unknown) {
  const url = String(webhookUrl || "").trim();
  if (!/^https:\/\/discord\.com\/api\/webhooks\//i.test(url)) return;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
  } finally {
    clearTimeout(t);
  }
}

function rolePingContent() {
  const roleId = String(process.env.DISCORD_PING_ROLE_ID || "").trim();
  if (!/^\d{10,30}$/.test(roleId)) return "";
  return `<@&${roleId}>`;
}

export async function notifyDiscord(
  kind: DiscordKind,
  args: {
    title: string;
    fields?: DiscordField[];
    content?: string;
    color?: number;
    email?: string;
  }
) {
  const webhookUrl = pickWebhookUrl(kind);
  if (!webhookUrl) return;

  const nowIso = new Date().toISOString();
  const safeTitle = truncate(args.title, 200);
  const fields = (args.fields || [])
    .filter((f) => f && typeof f.name === "string" && typeof f.value === "string")
    .slice(0, 20)
    .map((f) => ({
      name: truncate(f.name, 256),
      value: truncate(f.value, 1024) || "—",
      inline: !!f.inline,
    }));

  if (args.email) fields.unshift({ name: "Email", value: maskEmail(args.email), inline: true });

  const contentBase = truncate(args.content || "", 1800);
  const ping = kind === "support" || kind === "errors" || kind === "reports" ? rolePingContent() : "";
  const content = truncate([ping, contentBase].filter(Boolean).join("\n"), 1900);

  const payload = {
    content: content || undefined,
    embeds: [
      {
        title: safeTitle,
        color:
          typeof args.color === "number"
            ? args.color
            : kind === "support" || kind === "errors" || kind === "reports"
              ? 0xef4444
              : kind === "purchases"
                ? 0x8b5cf6
              : kind === "suggestions"
                ? 0xf59e0b
                : kind === "signup" || kind === "signin"
                  ? 0x22c55e
                  : 0x60a5fa,
        fields,
        timestamp: nowIso,
      },
    ],
    allowed_mentions: ping ? { parse: [], roles: [String(process.env.DISCORD_PING_ROLE_ID || "").trim()] } : { parse: [] },
  };

  await postWebhook(webhookUrl, payload);
}

import Brevo from "@getbrevo/brevo";

const senderEmail = "support@mestrygames.com";
const senderName = "MestryGames";

export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();
  if (!apiKey) return { ok: false as const, error: "not_configured" as const };

  const client = new Brevo.TransactionalEmailsApi();
  client.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  const payload = new Brevo.SendSmtpEmail();
  payload.subject = subject;
  payload.htmlContent = html;
  payload.sender = { email: senderEmail, name: senderName };
  payload.to = [{ email: to }];

  try {
    await client.sendTransacEmail(payload);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "send_failed" as const };
  }
}

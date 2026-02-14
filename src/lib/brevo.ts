import { sendEmail } from "@/lib/email";

type SendBrevoEmailArgs = {
  toEmail: string;
  subject: string;
  html: string;
};

export async function sendBrevoEmail(args: SendBrevoEmailArgs) {
  return sendEmail(args.toEmail, args.subject, args.html);
}

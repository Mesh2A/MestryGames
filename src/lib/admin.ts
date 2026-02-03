export function isAdminEmail(email: string | null | undefined) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;

  const single = String(process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  if (single) return e === single;

  const allow = String(process.env.ADMIN_EMAILS || "")
    .split(/[,\s]+/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  if (!allow.length) return false;
  return allow.includes(e);
}

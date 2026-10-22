// "Forgot password?" rules and the reset email, kept free of server-only
// imports so they can be unit tested (tests/password-reset.test.ts). The
// actions are in src/app/forgot-password/actions.ts.

export const RESET_LINK_TTL_MINUTES = 60;

/** Shown whether or not the address has an account, so the form can't be used to find out who does. */
export const RESET_SENT_MESSAGE =
  "If that email has a Campus OS account, we sent it a link to reset the password. It works for an hour. Check your spam folder if it doesn't arrive in a few minutes.";

export const RESET_LINK_INVALID_MESSAGE = "This link has expired or was already used. Ask for a new one below.";

export function resetLinkExpiry(now: Date): Date {
  return new Date(now.getTime() + RESET_LINK_TTL_MINUTES * 60_000);
}

export function isResetLinkUsable(link: { expiresAt: Date; usedAt: Date | null }, now: Date): boolean {
  return link.usedAt === null && link.expiresAt > now;
}

export function resetLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function resetEmail(to: string, link: string): { subject: string; text: string; html: string } {
  const subject = "Reset your Campus OS password";
  const lines = [
    `Someone asked to reset the password for the Campus OS account ${to}.`,
    `To choose a new password, open this link within the next hour:`,
    link,
    `If that wasn't you, you can ignore this email. Your password won't change.`,
  ];
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;line-height:1.5;max-width:480px;margin:0 auto;padding:24px">
<p>Someone asked to reset the password for the Campus OS account <strong>${escapeHtml(to)}</strong>.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Choose a new password</a></p>
<p style="color:#555;font-size:14px">The link works for an hour. If the button doesn't work, copy this address into your browser:<br>${escapeHtml(link)}</p>
<p style="color:#555;font-size:14px">If that wasn't you, you can ignore this email. Your password won't change.</p>
</body></html>`;
  return { subject, text: lines.join("\n\n"), html };
}

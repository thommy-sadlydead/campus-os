// Opening a prewritten email in the student's own mail app or webmail
// (the "Email your professor" card, src/components/classes/GetHelpCard.tsx).
// Campus OS never sends these itself. Pure, so client components can use it.

export interface ComposeInput {
  to: string;
  cc: string | null;
  subject: string;
  body: string;
}

const enc = (v: string) => encodeURIComponent(v);

/** Opens the student's email app with the email written (RFC 6068). */
export function mailtoLink({ to, cc, subject, body }: ComposeInput): string {
  const params = [cc ? `cc=${enc(cc)}` : null, `subject=${enc(subject)}`, `body=${enc(body.replace(/\n/g, "\r\n"))}`].filter(Boolean);
  return `mailto:${enc(to).replace(/%40/g, "@")}?${params.join("&")}`;
}

/** Gmail's compose window in the browser, for students without an email app set up. */
export function gmailLink({ to, cc, subject, body }: ComposeInput): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}${cc ? `&cc=${enc(cc)}` : ""}&su=${enc(subject)}&body=${enc(body)}`;
}

/** Outlook on the web, which many schools' email is. */
export function outlookLink({ to, cc, subject, body }: ComposeInput): string {
  return `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}${cc ? `&cc=${enc(cc)}` : ""}&subject=${enc(subject)}&body=${enc(body)}`;
}

/** The whole email as text, for pasting anywhere else. */
export function emailAsText({ to, cc, subject, body }: ComposeInput): string {
  return [`To: ${to}`, cc ? `Cc: ${cc}` : null, `Subject: ${subject}`, "", body].filter((l) => l !== null).join("\n");
}

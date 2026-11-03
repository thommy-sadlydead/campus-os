// Connect → Brightspace/Blackboard → Ask your school: an email a student
// sends their school (from their own mail app) asking it to turn on
// Campus OS in that LMS, so it can read directions, what's turned in and
// course files the way it does for Canvas. Each LMS only opens its API to
// apps a school's admin has enabled. Pure, tested in
// tests/school-request.test.ts; the counting is SchoolAccessRequest.

import type { FeedProvider } from "@/lib/lms/providers";

/** Hosts the LMS company runs for schools: an address there says nothing about which school it is. */
const VENDOR_DOMAINS = ["brightspace.com", "desire2learn.com", "d2l.com", "blackboard.com", "blackboardcdn.com"];

/** "learn.school.edu" from an LMS address (LmsConnection.baseUrl); null if it isn't one. */
export function schoolHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value.trim()) && value.trim().length <= 200;
}

/**
 * Whether an address another student typed may be suggested to everyone at
 * that school: it has to be at the school's own domain (help@school.edu for
 * learn.school.edu). For a school on the LMS company's own hosting
 * (school.brightspace.com) nothing can be checked, so nothing is suggested.
 */
export function contactFitsSchool(email: string, host: string): boolean {
  if (!isEmailAddress(email)) return false;
  if (VENDOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain.includes(".") && (host === domain || host.endsWith(`.${domain}`));
}

/** The address most students at the school used (the latest one on a tie), if it fits the school. */
export function suggestedContact(rows: { contactEmail: string | null; updatedAt: Date }[], host: string): string | null {
  const tally = new Map<string, { count: number; latest: number }>();
  for (const row of rows) {
    if (!row.contactEmail || !contactFitsSchool(row.contactEmail, host)) continue;
    const email = row.contactEmail.trim().toLowerCase();
    const t = tally.get(email) ?? { count: 0, latest: 0 };
    tally.set(email, { count: t.count + 1, latest: Math.max(t.latest, row.updatedAt.getTime()) });
  }
  const best = [...tally.entries()].sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)[0];
  return best?.[0] ?? null;
}

export interface SchoolRequestInput {
  provider: FeedProvider;
  providerName: string;
  studentName: string | null;
  /** This site, for the links in the email. */
  appUrl: string;
  /** CONTACT_EMAIL: copied on the email, so the school can reach the developer. */
  supportEmail: string | null;
  /** BLACKBOARD_APP_ID: what a Blackboard admin enters to turn Campus OS on. */
  blackboardAppId: string | null;
}

export function schoolRequestEmail(input: SchoolRequestInput): { subject: string; body: string } {
  const { providerName: lms, appUrl } = input;
  const reach = input.supportEmail
    ? `The Campus OS developer is copied here (${input.supportEmail}) and can answer questions or send any security and privacy documents you need.`
    : `You can reach the Campus OS developer at ${appUrl}/support for questions or security and privacy documents.`;
  const setup =
    input.provider === "blackboard"
      ? input.blackboardAppId
        ? `For the ${lms} admin: in Administrator Tools > Integrations > REST API Integrations, create an integration with Application ID ${input.blackboardAppId}, End User Access set to Yes, and a ${lms} user without admin privileges.`
        : `The developer can send the ${lms} admin the Application ID and setup steps.`
      : `For the ${lms} admin: this is an OAuth 2.0 app registration under Admin Tools > Manage Extensibility, with read-only scopes. The developer can send the exact settings.`;

  const body = [
    "Hello,",
    "",
    `I use Campus OS (${appUrl}), a student planner, for my classes. It brings in my due dates from ${lms}'s calendar, but not assignment directions, what I've turned in, or course files, because ${lms} only shares those with apps the school has turned on.`,
    "",
    `Could the team that runs ${lms} turn on Campus OS? Each student signs in with their own ${lms} account and has to allow it, and Campus OS only reads what that student can already see. It can't submit, post or change anything in ${lms}. Privacy policy: ${appUrl}/privacy`,
    "",
    setup,
    "",
    reach,
    "",
    "Thank you,",
    input.studentName?.trim() || "",
  ]
    .join("\n")
    .trimEnd();

  return { subject: `Request: turn on Campus OS in ${lms}`, body };
}

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

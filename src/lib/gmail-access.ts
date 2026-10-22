import { prisma } from "@/lib/prisma";

// Who can connect Gmail. Google keeps the Gmail sign-in in "Testing" until
// the app passes Google's verification for the gmail.readonly scope (which
// includes a yearly security assessment); until then everyone not on the
// Google Cloud test-user list gets "Access blocked". So Connect Gmail is
// only offered to the emails in GMAIL_TESTERS (the same people as that
// list), or to everyone once GMAIL_PUBLIC=1 after verification. An account
// that already connected Gmail keeps it either way.

/** GMAIL_TESTERS: comma-separated, any case. */
export function gmailOpenTo(
  email: string,
  testers = process.env.GMAIL_TESTERS,
  isPublic = process.env.GMAIL_PUBLIC
): boolean {
  if (isPublic === "1") return true;
  const list = (testers ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Whether to show this account the Email pages and Connect Gmail. */
export async function canUseGmail(user: { id: string; email: string }): Promise<boolean> {
  if (gmailOpenTo(user.email)) return true;
  return (await prisma.emailAccount.count({ where: { userId: user.id } })) > 0;
}

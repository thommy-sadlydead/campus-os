import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { SyncButton } from "@/components/email/SyncButton";
import { PendingChangesQueue } from "@/components/email/PendingChangesQueue";
import { InboxFeed } from "@/components/email/InboxFeed";
import { ConnectGmailButton } from "@/components/email/ConnectGmailButton";
import { disconnectEmailAction } from "@/app/email/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckCircleIcon, MailIcon } from "@/components/icons";

// syncEmailAction (run from SyncButton) reads and classifies up to 60
// messages per run, a few seconds each, which can outlast Vercel's default
// function duration. Same limit as the Canvas and class pages.
export const maxDuration = 300;

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;

  const account = await prisma.emailAccount.findUnique({ where: { userId: user.id } });

  if (!account) {
    return (
      <AppShell active="/email" userName={user.name ?? user.email}>
        <PageHeader
          title="Email"
          description="Connect your school Gmail to surface due-date changes, room/schedule changes, syllabus updates, and professor instructions — automatically, without ever handing this app your password."
        />

        {error && <div className="mb-4 rounded-xl2 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

        <div className="card card-pad max-w-2xl sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <MailIcon className="h-[22px] w-[22px]" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">How this works</h2>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm text-ink-soft">
            {[
              "You sign in on Google's own screen, so Campus OS never sees your password.",
              "Campus OS can only read email. It can't send, delete or change anything in your inbox.",
              "It looks at your recent inbox and keeps only school-related messages.",
              "If an email changes a due date or room, Campus OS asks you before updating anything.",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <CheckCircleIcon className="mt-px h-[18px] w-[18px] flex-none text-ok" />
                {line}
              </li>
            ))}
          </ul>
          <ConnectGmailButton className="btn btn-primary btn-lg" />
        </div>
      </AppShell>
    );
  }

  const [pendingChangesRaw, emailsRaw] = await Promise.all([
    prisma.pendingChange.findMany({
      where: { userId: user.id, status: "PENDING" },
      include: { class: true, sourceEmail: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.email.findMany({
      where: { userId: user.id, category: { notIn: ["IRRELEVANT", "UNCLASSIFIED"] } },
      include: { class: true },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <AppShell active="/email" userName={user.name ?? user.email}>
      <PageHeader
        title="Email"
        description={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="dot bg-ok" />
            Connected as {account.emailAddress}
          </span>
        }
        actions={
          <>
            <SyncButton
              lastSyncedLabel={
                account.lastSyncedAt
                  ? `Last synced ${formatPastMoment(account.lastSyncedAt, new Date(), user.timezone)}`
                  : "Never synced yet"
              }
            />
            <form action={disconnectEmailAction}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          </>
        }
      />

      <PendingChangesQueue
        changes={pendingChangesRaw.map((c) => ({
          id: c.id,
          entityType: c.entityType,
          entityId: c.entityId,
          field: c.field,
          oldValueText: c.oldValueText,
          newValueText: c.newValueText,
          reason: c.reason,
          className: c.class?.name ?? null,
          sourceSubject: c.sourceEmail?.subject ?? null,
          sourceGmailId: c.sourceEmail?.gmailMessageId ?? null,
        }))}
      />

      <h2 className="mb-3 text-sm font-semibold text-ink">Academic feed</h2>
      <InboxFeed
        emails={emailsRaw.map((e) => ({
          id: e.id,
          subject: e.subject,
          snippet: e.snippet,
          fromName: e.fromName,
          fromAddress: e.fromAddress,
          receivedAt: e.receivedAt.toISOString(),
          category: e.category,
          className: e.class?.name ?? null,
          gmailMessageId: e.gmailMessageId,
        }))}
      />
    </AppShell>
  );
}

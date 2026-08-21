import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { SyncButton } from "@/components/email/SyncButton";
import { PendingChangesQueue } from "@/components/email/PendingChangesQueue";
import { InboxFeed } from "@/components/email/InboxFeed";
import { disconnectEmailAction } from "@/app/email/actions";

export default async function EmailPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const user = await requireUser();

  const account = await prisma.emailAccount.findUnique({ where: { userId: user.id } });

  if (!account) {
    return (
      <AppShell active="/email" userName={user.name ?? user.email}>
        <h1 className="mb-1 font-display text-2xl font-semibold">Email</h1>
        <p className="mb-6 text-sm text-ink-soft">
          Connect your school Gmail to surface due-date changes, room/schedule changes, syllabus updates, and
          professor instructions — automatically, without ever handing this app your password.
        </p>

        {searchParams.error && (
          <div className="mb-4 rounded-xl2 border border-danger bg-danger-soft p-3 text-sm text-danger">
            {searchParams.error}
          </div>
        )}

        <div className="rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
          <h3 className="font-display text-base font-semibold">How this works</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-soft">
            <li>• Sign-in uses Google's own OAuth screen — your password never touches this app.</li>
            <li>• Only the read-only <code className="font-mono">gmail.readonly</code> scope is requested — nothing can be sent, deleted, or modified in your inbox.</li>
            <li>• Only recent inbox mail is scanned, and only academically-relevant messages are kept and shown here.</li>
            <li>• Anything an email suggests changing about your schedule always asks first if it conflicts with what's already on file — never a silent overwrite.</li>
          </ul>
          <a
            href="/api/email/oauth/start"
            className="mt-5 inline-block rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90"
          >
            Connect Gmail
          </a>
          <p className="mt-3 text-xs text-ink-faint">
            Requires a Google Cloud OAuth client — see <code className="font-mono">GOOGLE_CLIENT_ID</code> /{" "}
            <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in <code className="font-mono">.env.example</code>.
          </p>
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Email</h1>
          <p className="mt-0.5 text-sm text-ink-soft">Connected as {account.emailAddress}</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton
            lastSyncedLabel={
              account.lastSyncedAt ? `Last synced ${new Date(account.lastSyncedAt).toLocaleString()}` : "Never synced yet"
            }
          />
          <form action={disconnectEmailAction}>
            <button className="text-xs text-ink-faint hover:text-danger">Disconnect</button>
          </form>
        </div>
      </div>

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

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Academic feed</h2>
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

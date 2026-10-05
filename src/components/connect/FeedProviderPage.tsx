import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { AppShell } from "@/components/AppShell";
import { BackToConnect } from "@/components/connect/BackToConnect";
import { ConnectSteps, Ui } from "@/components/connect/ConnectSteps";
import { FeedConnect } from "@/components/connect/FeedConnect";
import { SyncButton } from "@/components/connect/SyncButton";
import { SyncReportCard } from "@/components/connect/SyncReportCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { CalendarIcon } from "@/components/icons";
import { getLmsConnection } from "@/lib/lms/connections";
import { LMS_PROVIDER_INFO, type FeedProvider } from "@/lib/lms/providers";
import { parseReport } from "@/lib/lms/report";
import { disconnectLmsAction, syncLmsAction } from "@/app/connect/actions";

const STEPS: Record<FeedProvider, React.ReactNode[]> = {
  brightspace: [
    <>In Brightspace, open <Ui>Calendar</Ui> (it&apos;s on your homepage and in each course).</>,
    <>
      Click <Ui>Settings</Ui>, tick <Ui>Enable Calendar Feeds</Ui>, and save.
    </>,
    <>
      Back in Calendar, click <Ui>Subscribe</Ui>, keep it set to all your courses, and copy the link.
    </>,
    <>Paste it here.</>,
  ],
  blackboard: [
    <>In Blackboard, open <Ui>Calendar</Ui> from the menu on the left.</>,
    <>
      Open <Ui>Calendar Settings</Ui>, then choose <Ui>Share Calendar</Ui>.
    </>,
    <>Copy the calendar link and paste it here.</>,
    <>
      On older Blackboard sites, the Calendar page has a <Ui>Get External Calendar Link</Ui> button instead.
    </>,
  ],
};

/**
 * The Connect page for an LMS that only shares its calendar with outside
 * apps (Brightspace, Blackboard): paste the feed link, check the classes it
 * found, connect; then sync, see the report, and edit the classes.
 */
export async function FeedProviderPage({ provider }: { provider: FeedProvider }) {
  const user = await requireUser();
  const connection = await getLmsConnection(user.id, provider);
  const info = LMS_PROVIDER_INFO[provider];
  const limits = `${info.name} only lets apps your school's IT department has approved read the rest of your courses, so Campus OS reads your calendar: your classes, due dates and exams. Directions, what you've turned in and course files stay in ${info.name}, so check work off here as you finish it, and use “Open in ${info.name}” for the details.`;

  if (!connection) {
    return (
      <AppShell active="/connect" userName={user.name ?? user.email}>
        <BackToConnect />
        <PageHeader
          title={`Connect ${info.name}`}
          description={`Brings in your ${info.fullName} classes, due dates and exams from your calendar. Campus OS only reads it; it can't change anything in ${info.name}.`}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card card-pad">
            <CardHeader icon={<CalendarIcon className="h-[18px] w-[18px]" />} title={`Your ${info.name} calendar`} />
            <FeedConnect provider={provider} providerName={info.name} mode="connect" />
          </div>

          <div className="card card-pad">
            <CardHeader title="Get your calendar link" />
            <ConnectSteps steps={STEPS[provider]} />
            <p className="mt-5 border-t border-border-soft pt-4 text-xs leading-relaxed text-ink-faint">{limits}</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              The link works like a password for your calendar, so it&apos;s encrypted before it&apos;s stored. You can
              disconnect any time.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="/connect" userName={user.name ?? user.email}>
      <BackToConnect />
      <PageHeader
        title={info.name}
        description={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="dot bg-ok" />
            Connected to {connection.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        }
        actions={
          <>
            <SyncButton
              action={syncLmsAction.bind(null, provider)}
              lastSyncedLabel={
                connection.lastSyncedAt
                  ? `Last synced ${formatPastMoment(connection.lastSyncedAt, new Date(), user.timezone)}`
                  : "Never synced yet"
              }
            />
            <form action={disconnectLmsAction.bind(null, provider)}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          </>
        }
      />

      <SyncReportCard report={parseReport(connection.lastSyncReport)} lmsName={info.name} tz={user.timezone} footnote={limits} />

      <div className="card card-pad">
        <CardHeader
          icon={<CalendarIcon className="h-[18px] w-[18px]" />}
          title="Classes from your calendar"
          description="Rename a class, or leave one out (it's hidden, not deleted, and comes back if you include it again)."
        />
        <FeedConnect provider={provider} providerName={info.name} mode="edit" />
      </div>
    </AppShell>
  );
}

import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { AppShell } from "@/components/AppShell";
import { BackToConnect } from "@/components/connect/BackToConnect";
import { ConnectSteps, Ui } from "@/components/connect/ConnectSteps";
import { ConnectVideo } from "@/components/connect/ConnectVideo";
import { FeedConnect } from "@/components/connect/FeedConnect";
import { SyncButton } from "@/components/connect/SyncButton";
import { SyncReportCard } from "@/components/connect/SyncReportCard";
import { ExtensionConnect } from "@/components/connect/ExtensionConnect";
import { ExtensionProgressPanel } from "@/components/connect/ExtensionProgressPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { CalendarIcon, LayersIcon } from "@/components/icons";
import { getLmsConnection } from "@/lib/lms/connections";
import { LMS_PROVIDER_INFO, type FeedProvider } from "@/lib/lms/providers";
import { parseReport } from "@/lib/lms/report";
import { importSummary } from "@/lib/lms/extension-import";
import { disconnectLmsAction, syncLmsAction } from "@/app/connect/actions";
import { disconnectExtensionAction } from "@/app/connect/extension-actions";

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

/** The calendar link, for students who can't use the extension (an iPhone or iPad, Safari, a phone). */
function CalendarLinkOption({ provider, providerName }: { provider: FeedProvider; providerName: string }) {
  return (
    <details className="card card-pad group">
      <summary className="flex cursor-pointer list-none items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
          <CalendarIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="pt-0.5">
          <span className="block text-[15px] font-semibold text-ink">No Chrome on a computer? Use your calendar link</span>
          <span className="mt-0.5 block text-sm text-ink-soft">
            Works anywhere, including the iPhone and iPad app. It brings in your classes, due dates and exams, but not course files,
            directions or what you&apos;ve turned in.
          </span>
        </span>
      </summary>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <FeedConnect provider={provider} providerName={providerName} mode="connect" />
        </div>
        <div>
          <ConnectVideo lms={provider} lmsName={providerName} />
          <ConnectSteps steps={STEPS[provider]} />
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            The link works like a password for your calendar, so it&apos;s encrypted before it&apos;s stored. You can disconnect any time.
          </p>
        </div>
      </div>
    </details>
  );
}

/**
 * The Connect page for Brightspace or Blackboard. The Campus OS Chrome
 * extension is the main way in: it reads the student's courses,
 * assignments and files with the sign-in they already have
 * (src/lib/lms/extension-import.ts). The calendar link stays as the
 * fallback for anyone who can't use Chrome on a computer.
 */
export async function SchoolLmsPage({ provider }: { provider: FeedProvider }) {
  const user = await requireUser();
  const connection = await getLmsConnection(user.id, provider);
  const info = LMS_PROVIDER_INFO[provider];
  const installUrl = process.env.CHROME_EXTENSION_URL?.trim() || null;
  const now = new Date();

  if (connection?.method === "extension") {
    const courses = await importSummary(user.id, provider);
    const report = parseReport(connection.lastSyncReport);
    return (
      <AppShell active="/connect" userName={user.name ?? user.email}>
        <BackToConnect />
        <PageHeader
          title={info.name}
          description={
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="dot bg-ok" />
              Connected through the Campus OS extension to {new URL(connection.baseUrl).host}
              {connection.lastSyncedAt ? ` · last synced ${formatPastMoment(connection.lastSyncedAt, now, user.timezone)}` : ""}
            </span>
          }
          actions={
            <form action={disconnectExtensionAction.bind(null, provider)}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          }
        />
        <div className="flex flex-col gap-6">
          <div className="card card-pad">
            <CardHeader icon={<LayersIcon className="h-[18px] w-[18px]" />} title="Sync" description={`It also syncs on its own when you open ${info.name} in Chrome, if it's been a few hours.`} />
            <div className="mt-4">
              <ExtensionConnect provider={provider} providerName={info.name} installUrl={installUrl} accountEmail={user.email} connected />
            </div>
          </div>
          <ExtensionProgressPanel
            provider={provider}
            initial={{ lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null, error: report?.error ?? null, courses }}
          />
          <SyncReportCard report={report} lmsName={info.name} tz={user.timezone} />
        </div>
      </AppShell>
    );
  }

  const extensionCard = (
    <div className="card card-pad">
      <CardHeader
        icon={<LayersIcon className="h-[18px] w-[18px]" />}
        title={connection ? "Get course files and full assignments" : "Connect with the Campus OS extension"}
        description={`Brings in your ${info.fullName} courses, assignments with their directions and due dates, and course files: slides, PDFs, Word documents and pages.`}
      />
      <div className="mt-5">
        <ExtensionConnect provider={provider} providerName={info.name} installUrl={installUrl} accountEmail={user.email} connected={false} />
      </div>
      {connection && (
        <p className="mt-4 border-t border-border-soft pt-4 text-xs leading-relaxed text-ink-faint">
          Once the extension imports your courses, it takes over from your calendar link, and deadlines already here from the calendar
          are merged with the full ones instead of showing twice.
        </p>
      )}
    </div>
  );

  if (!connection) {
    return (
      <AppShell active="/connect" userName={user.name ?? user.email}>
        <BackToConnect />
        <PageHeader
          title={`Connect ${info.name}`}
          description={`Brings in your ${info.fullName} classes, assignments, due dates and course files. Campus OS only reads them; it can't change anything in ${info.name}.`}
        />
        <div className="flex flex-col gap-6">
          {extensionCard}
          <CalendarLinkOption provider={provider} providerName={info.name} />
        </div>
      </AppShell>
    );
  }

  // Connected by calendar link.
  const limits = `Your calendar brings in classes, due dates and exams. Directions, what you've turned in and course files stay in ${info.name} unless you connect the extension, so check work off here as you finish it.`;
  return (
    <AppShell active="/connect" userName={user.name ?? user.email}>
      <BackToConnect />
      <PageHeader
        title={info.name}
        description={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="dot bg-ok" />
            Connected by calendar link to {connection.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        }
        actions={
          <>
            <SyncButton
              action={syncLmsAction.bind(null, provider)}
              lastSyncedLabel={
                connection.lastSyncedAt ? `Last synced ${formatPastMoment(connection.lastSyncedAt, now, user.timezone)}` : "Never synced yet"
              }
            />
            <form action={disconnectLmsAction.bind(null, provider)}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {extensionCard}
        <SyncReportCard report={parseReport(connection.lastSyncReport)} lmsName={info.name} tz={user.timezone} footnote={limits} />
        <div className="card card-pad">
          <CardHeader
            icon={<CalendarIcon className="h-[18px] w-[18px]" />}
            title="Classes from your calendar"
            description="Rename a class, or leave one out (it's hidden, not deleted, and comes back if you include it again)."
          />
          <FeedConnect provider={provider} providerName={info.name} mode="edit" />
        </div>
      </div>
    </AppShell>
  );
}

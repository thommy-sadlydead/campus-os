import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { AppShell } from "@/components/AppShell";
import { BackToConnect } from "@/components/connect/BackToConnect";
import { ConnectSchoologyForm } from "@/components/connect/ConnectSchoologyForm";
import { ConnectSteps, Ui } from "@/components/connect/ConnectSteps";
import { MaterialSyncPanel } from "@/components/connect/MaterialSyncPanel";
import { SyncButton } from "@/components/connect/SyncButton";
import { SyncReportCard } from "@/components/connect/SyncReportCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { LayersIcon } from "@/components/icons";
import { getLmsConnection } from "@/lib/lms/connections";
import { parseReport } from "@/lib/lms/report";
import {
  continueSchoologyMaterialSyncAction,
  disconnectLmsAction,
  startSchoologyMaterialSyncAction,
  syncLmsAction,
} from "@/app/connect/actions";

// The first sync and the materials sync check each assignment's dropbox and
// download files, spaced out for Schoology's rate limit (see the Canvas page).
export const maxDuration = 300;

export default async function SchoologyPage() {
  const user = await requireUser();
  const connection = await getLmsConnection(user.id, "schoology");

  if (!connection) {
    return (
      <AppShell active="/connect" userName={user.name ?? user.email}>
        <BackToConnect />
        <PageHeader
          title="Connect Schoology"
          description="Brings in your courses, assignments and tests with their directions, due dates, grades and what you've turned in, exams, and course files. Campus OS only reads from Schoology; it can't submit, change or delete anything there."
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card card-pad">
            <CardHeader icon={<LayersIcon className="h-[18px] w-[18px]" />} title="Your Schoology" />
            <ConnectSchoologyForm />
          </div>

          <div className="card card-pad">
            <CardHeader title="Get your API key" />
            <ConnectSteps
              steps={[
                <>Sign in to Schoology in your browser.</>,
                <>
                  Go to your school&apos;s Schoology address with <Ui>/api</Ui> on the end, like{" "}
                  <Ui>app.schoology.com/api</Ui>.
                </>,
                <>
                  Copy the <Ui>Current Consumer Key</Ui> and <Ui>Current Consumer Secret</Ui>. If there aren&apos;t
                  any, click <Ui>Request API Keys</Ui> first.
                </>,
                <>Paste them here, with your Schoology address.</>,
              ]}
            />
            <p className="mt-5 border-t border-border-soft pt-4 text-xs leading-relaxed text-ink-faint">
              Your key is encrypted before it&apos;s stored and is only used to read your courses. If the API page
              says you don&apos;t have access, your school has turned off API keys for students, so Campus OS
              can&apos;t read your Schoology. You can disconnect any time.
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
        title="Schoology"
        description={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="dot bg-ok" />
            Connected to {connection.baseUrl}
          </span>
        }
        actions={
          <>
            <SyncButton
              action={syncLmsAction.bind(null, "schoology")}
              lastSyncedLabel={
                connection.lastSyncedAt
                  ? `Last synced ${formatPastMoment(connection.lastSyncedAt, new Date(), user.timezone)}`
                  : "Never synced yet"
              }
            />
            <form action={disconnectLmsAction.bind(null, "schoology")}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          </>
        }
      />

      <SyncReportCard
        report={parseReport(connection.lastSyncReport)}
        lmsName="Schoology"
        tz={user.timezone}
        footnote="Graded work comes from your Schoology grades. Whether you've turned something in is checked for work due from a week ago to a month out; for anything else, check it off here when you're done."
      />

      <MaterialSyncPanel lmsName="Schoology" start={startSchoologyMaterialSyncAction} advance={continueSchoologyMaterialSyncAction} />
    </AppShell>
  );
}

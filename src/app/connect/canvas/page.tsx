import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ConnectCanvasForm } from "@/components/connect/ConnectCanvasForm";
import { SyncButton } from "@/components/connect/SyncButton";
import { MaterialSyncPanel } from "@/components/connect/MaterialSyncPanel";
import { ConnectSteps, Ui } from "@/components/connect/ConnectSteps";
import { SyncReportCard } from "@/components/connect/SyncReportCard";
import {
  continueCanvasMaterialSyncAction,
  disconnectCanvasAction,
  startCanvasMaterialSyncAction,
  syncCanvasAction,
} from "@/app/connect/canvas/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { parseReport } from "@/lib/lms/report";
import { LayersIcon } from "@/components/icons";
import { BackToConnect } from "@/components/connect/BackToConnect";

// continueCanvasMaterialSyncAction (invoked from MaterialSyncPanel) can now
// process a scanned PDF via OCR mid-chunk — several sequential per-page
// Claude vision calls — which can comfortably exceed Vercel's default
// function duration. Matches the same need/pattern as
// src/app/classes/[id]/page.tsx's maxDuration for lecture note generation.
export const maxDuration = 300;

export default async function CanvasPage() {
  const user = await requireUser();
  const account = await prisma.canvasAccount.findUnique({ where: { userId: user.id } });

  if (!account) {
    return (
      <AppShell active="/connect" userName={user.name ?? user.email}>
        <BackToConnect />
        <PageHeader
          title="Connect Canvas"
          description="Brings in your courses, assignments with their directions, due dates, what you've turned in, exams, and course files. Campus OS only reads from Canvas; it can't submit, change or delete anything there."
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card card-pad">
            <CardHeader icon={<LayersIcon className="h-[18px] w-[18px]" />} title="Your Canvas" />
            <ConnectCanvasForm />
          </div>

          <div className="card card-pad">
            <CardHeader title="Get an access token" />
            <ConnectSteps
              steps={[
                <>In Canvas, go to Account → Settings.</>,
                <>
                  Scroll to <Ui>Approved Integrations</Ui> and click <Ui>+ New Access Token</Ui>.
                </>,
                <>Give it a purpose like &quot;Campus OS&quot; and click Generate Token.</>,
                <>Copy it now — Canvas only shows it once.</>,
              ]}
            />
            <p className="mt-5 border-t border-border-soft pt-4 text-xs leading-relaxed text-ink-faint">
              Your token is encrypted before it&apos;s stored and is only used to read your courses. You can
              disconnect any time, and delete the token in Canvas under Approved Integrations.
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
        title="Canvas"
        description={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="dot bg-ok" />
            Connected to {account.baseUrl}
          </span>
        }
        actions={
          <>
            <SyncButton
              action={syncCanvasAction}
              lastSyncedLabel={
                account.lastSyncedAt
                  ? `Last synced ${formatPastMoment(account.lastSyncedAt, new Date(), user.timezone)}`
                  : "Never synced yet"
              }
            />
            <form action={disconnectCanvasAction}>
              <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
            </form>
          </>
        }
      />

      <SyncReportCard report={parseReport(account.lastSyncReport)} lmsName="Canvas" tz={user.timezone} />

      <MaterialSyncPanel lmsName="Canvas" start={startCanvasMaterialSyncAction} advance={continueCanvasMaterialSyncAction} />
    </AppShell>
  );
}

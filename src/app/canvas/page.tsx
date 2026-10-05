import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ConnectCanvasForm } from "@/components/canvas/ConnectCanvasForm";
import { SyncButton } from "@/components/canvas/SyncButton";
import { MaterialSyncPanel } from "@/components/canvas/MaterialSyncPanel";
import { disconnectCanvasAction } from "@/app/canvas/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { SyncReportCard } from "@/components/connect/SyncReportCard";
import { parseReport } from "@/lib/lms/report";
import { CheckCircleIcon, LayersIcon } from "@/components/icons";

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
      <AppShell active="/canvas" userName={user.name ?? user.email}>
        <PageHeader
          title="Canvas"
          description="Connect Canvas to bring in your courses, assignments, due dates and course files. Campus OS only reads from Canvas; it can't submit, change or delete anything there."
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card card-pad">
            <CardHeader icon={<LayersIcon className="h-[18px] w-[18px]" />} title="Connect Canvas" />
            <ConnectCanvasForm defaultBaseUrl={process.env.CANVAS_BASE_URL || "https://cedarville.instructure.com"} />
          </div>

          <div className="card card-pad">
            <CardHeader title="Get an access token" />
            <ol className="mt-4 flex flex-col gap-3 text-sm text-ink-soft">
              {[
                <>In Canvas, go to Account → Settings.</>,
                <>
                  Scroll to <strong className="font-semibold text-ink">Approved Integrations</strong> and click{" "}
                  <strong className="font-semibold text-ink">+ New Access Token</strong>.
                </>,
                <>Give it a purpose like &quot;Campus OS&quot; and click Generate Token.</>,
                <>Copy it now — Canvas only shows it once.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-soft">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
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
    <AppShell active="/canvas" userName={user.name ?? user.email}>
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

      <div className="card card-pad mb-6 flex gap-3 text-sm leading-relaxed text-ink-soft">
        <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none text-ok" />
        <p>
          Your classes, assignments, and exams are pulled from here — check the{" "}
          <a href="/classes" className="font-medium text-accent-ink underline underline-offset-2">
            Classes
          </a>{" "}
          and{" "}
          <a href="/assignments" className="font-medium text-accent-ink underline underline-offset-2">
            Assignments
          </a>{" "}
          pages to see what&apos;s synced. Syncing again any time is safe — it updates existing courses and
          assignments instead of duplicating them.
        </p>
      </div>

      <SyncReportCard report={parseReport(account.lastSyncReport)} lmsName="Canvas" tz={user.timezone} />

      <MaterialSyncPanel />
    </AppShell>
  );
}

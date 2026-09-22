import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ConnectCanvasForm } from "@/components/canvas/ConnectCanvasForm";
import { SyncButton } from "@/components/canvas/SyncButton";
import { MaterialSyncPanel } from "@/components/canvas/MaterialSyncPanel";
import { disconnectCanvasAction } from "@/app/canvas/actions";

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
        <h1 className="mb-1 font-display text-2xl font-semibold">Canvas</h1>
        <p className="mb-6 text-sm text-ink-soft">
          Connect Canvas to pull in your real courses and assignments — no more relying on the seeded
          demo data.
        </p>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
            <h3 className="font-display text-base font-semibold">Connect Canvas</h3>
            <ConnectCanvasForm defaultBaseUrl={process.env.CANVAS_BASE_URL || "https://cedarville.instructure.com"} />
          </div>

          <div className="rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
            <h3 className="font-display text-base font-semibold">Get an access token</h3>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-4 text-sm text-ink-soft">
              <li>In Canvas, go to Account → Settings.</li>
              <li>
                Scroll to <strong>Approved Integrations</strong> and click{" "}
                <strong>+ New Access Token</strong>.
              </li>
              <li>Give it a purpose like "Campus OS" and click Generate Token.</li>
              <li>Copy it now — Canvas only shows it once.</li>
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              The token is encrypted before it's stored, the same way Gmail's connection is (see
              Security notes in the README), and is only ever used to read your courses and
              assignments — this app can't submit, edit, or delete anything in Canvas on your behalf.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="/canvas" userName={user.name ?? user.email}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Canvas</h1>
          <p className="mt-0.5 text-sm text-ink-soft">Connected to {account.baseUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton
            lastSyncedLabel={
              account.lastSyncedAt
                ? `Last synced ${new Date(account.lastSyncedAt).toLocaleString()}`
                : "Never synced yet"
            }
          />
          <form action={disconnectCanvasAction}>
            <button className="text-xs text-ink-faint hover:text-danger">Disconnect</button>
          </form>
        </div>
      </div>

      <div className="mb-6 rounded-xl2 border border-border-soft bg-surface p-6 shadow-card text-sm text-ink-soft">
        Your classes, assignments, and exams are pulled from here — check the{" "}
        <a href="/classes" className="text-accent underline">
          Classes
        </a>{" "}
        and{" "}
        <a href="/assignments" className="text-accent underline">
          Assignments
        </a>{" "}
        pages to see what's synced. Syncing again any time is safe — it updates existing courses and
        assignments instead of duplicating them.
      </div>

      <MaterialSyncPanel />
    </AppShell>
  );
}

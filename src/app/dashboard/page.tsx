import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { TaskRow } from "@/components/dashboard/TaskRow";
import { WhatNowPanel } from "@/components/dashboard/WhatNowPanel";
import { MinutesMode } from "@/components/dashboard/MinutesMode";
import { WorkloadSummaryCard } from "@/components/dashboard/WorkloadSummaryCard";
import { AvailabilityCard } from "@/components/dashboard/AvailabilityCard";
import { AskPanel } from "@/components/dashboard/AskPanel";
import { RiskStatusCard } from "@/components/dashboard/RiskStatusCard";
import Link from "next/link";
import { loadWorkItemsForUser, getAvailableMinutesToday } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary, type UrgencyBucket } from "@/lib/priority-engine";
import { assessRisk } from "@/lib/risk-engine";
import { formatDueLabel, startOfTzDay } from "@/lib/time";

const SECTION_TITLES: Record<UrgencyBucket, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  THIS_WEEK: "This week",
  LATER: "Later",
  NO_DATE: "No due date",
};

const SECTION_ORDER: UrgencyBucket[] = ["OVERDUE", "TODAY", "TOMORROW", "THIS_WEEK", "LATER", "NO_DATE"];

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [items, availableMinutesToday, availabilityBlocks, pendingChangeCount] = await Promise.all([
    loadWorkItemsForUser(user.id),
    getAvailableMinutesToday(user.id, now, user.timezone),
    prisma.availabilityBlock.findMany({
      where: { userId: user.id, date: startOfTzDay(now, user.timezone) },
      orderBy: { startMinute: "asc" },
    }),
    prisma.pendingChange.count({ where: { userId: user.id, status: "PENDING" } }),
  ]);

  const ranked = rankWorkItems(items, now, user.timezone);
  const summary = computeWorkloadSummary(items, now, user.timezone, availableMinutesToday);
  const risk = assessRisk(ranked, summary, now, user.timezone);

  const grouped = new Map<UrgencyBucket, typeof ranked>();
  for (const r of ranked) {
    const list = grouped.get(r.bucket) ?? [];
    list.push(r);
    grouped.set(r.bucket, list);
  }

  return (
    <AppShell active="/dashboard" userName={user.name ?? user.email}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">What should I do right now?</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {ranked.length === 0
            ? "Nothing on your plate right now — you're fully caught up."
            : `${ranked.length} open item${ranked.length === 1 ? "" : "s"} across your classes.`}
        </p>
      </div>

      <RiskStatusCard risk={risk} />

      {pendingChangeCount > 0 && (
        <Link
          href="/email"
          className="mb-6 flex items-center justify-between rounded-xl2 border border-warn bg-warn-soft/40 px-4 py-3 text-sm hover:brightness-95"
        >
          <span>
            <strong>{pendingChangeCount}</strong> email-derived change{pendingChangeCount === 1 ? "" : "s"} waiting on your decision
          </span>
          <span className="text-accent-ink">Review →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {ranked.length === 0 ? (
            <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
              No open assignments yet. Run <code className="font-mono">npm run canvas:sync</code> to pull
              in your real coursework, or add one manually from the Assignments tab.
            </div>
          ) : (
            SECTION_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
              <section key={bucket}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  {SECTION_TITLES[bucket]}
                </h2>
                <ul className="flex flex-col gap-2">
                  {grouped.get(bucket)!.map((r) => (
                    <TaskRow
                      key={r.item.id}
                      id={r.item.id}
                      kind={r.item.kind}
                      title={r.item.title}
                      className={r.item.className}
                      color={r.color}
                      dueLabel={formatDueLabel(r.item.dueAt, now, user.timezone)}
                      estimatedMinutes={r.item.estimatedMinutes}
                      reason={r.reason}
                      description={r.item.description}
                      canvasUrl={r.item.canvasUrl}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="flex flex-col gap-6">
          <WhatNowPanel />
          <MinutesMode />
          <WorkloadSummaryCard summary={summary} now={now} tz={user.timezone} />
          <AvailabilityCard blocks={availabilityBlocks} />
          <AskPanel />
        </div>
      </div>
    </AppShell>
  );
}

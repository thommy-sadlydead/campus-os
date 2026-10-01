import { cookies, headers } from "next/headers";
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
import { NativeReminders } from "@/components/dashboard/NativeReminders";
import { AiConsentCard } from "@/components/account/AiConsent";
import { AI_NOT_NOW_COOKIE, hasAiConsent } from "@/lib/ai-consent";
import Link from "next/link";
import { ShowMore } from "@/components/ShowMore";
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

  // The iPhone app adds this to its user agent (capacitor.config.json); only
  // it can show reminders, so only it gets the deadlines for them.
  const inApp = (await headers()).get("user-agent")?.includes("CampusOSApp") ?? false;

  const [items, availableMinutesToday, availabilityBlocks, pendingChangeCount, classCount, reminderDeadlines] = await Promise.all([
    loadWorkItemsForUser(user.id),
    getAvailableMinutesToday(user.id, now, user.timezone),
    prisma.availabilityBlock.findMany({
      where: { userId: user.id, date: startOfTzDay(now, user.timezone) },
      orderBy: { startMinute: "asc" },
    }),
    prisma.pendingChange.count({ where: { userId: user.id, status: "PENDING" } }),
    prisma.class.count({ where: { userId: user.id, archived: false } }),
    inApp
      ? prisma.assignment.findMany({
          where: {
            class: { userId: user.id, archived: false },
            dueAt: { gt: now, lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) },
            status: { notIn: ["SUBMITTED", "GRADED"] },
          },
          select: { name: true, dueAt: true, class: { select: { name: true } } },
          orderBy: { dueAt: "asc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const ranked = rankWorkItems(items, now, user.timezone);
  const summary = computeWorkloadSummary(items, now, user.timezone, availableMinutesToday);
  const risk = assessRisk(ranked, summary, now, user.timezone);

  // Counts are of assignments: one broken into steps lists each step, but
  // it's still one thing due (see computeWorkloadSummary).
  const assignmentCount = (list: typeof ranked) => new Set(list.map((r) => r.item.assignmentId)).size;
  const openCount = assignmentCount(ranked);

  const grouped = new Map<UrgencyBucket, typeof ranked>();
  for (const r of ranked) {
    const list = grouped.get(r.bucket) ?? [];
    list.push(r);
    grouped.set(r.bucket, list);
  }

  // A brand-new account has nothing to rank yet; a green "on track" status
  // would be wrong, so it gets a welcome with the first step instead.
  if (classCount === 0) {
    return (
      <AppShell active="/dashboard" userName={user.name ?? user.email}>
        <div className="mx-auto max-w-xl rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Welcome to Campus OS</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Let&apos;s bring in your classes</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Your dashboard is built from Canvas: classes, assignments, due dates and course files. Setting it up
            takes about a minute.
          </p>
          <ol className="mt-5 flex list-decimal flex-col gap-3 pl-5 text-sm text-ink-soft">
            <li>
              <strong className="text-ink">Connect Canvas.</strong> You&apos;ll paste an access token from your Canvas
              settings; the Canvas page shows you where to find it.
            </li>
            <li>
              <strong className="text-ink">Add your class times</strong> on the Schedule page, so Record knows which
              class you&apos;re in.
            </li>
            <li>
              <strong className="text-ink">Optional: connect your school email</strong> to catch due-date and room
              changes your professors send.
            </li>
          </ol>
          <Link
            href="/canvas"
            className="mt-6 inline-block rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-surface hover:opacity-90"
          >
            Connect Canvas
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="/dashboard" userName={user.name ?? user.email}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">What should I do right now?</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {ranked.length === 0
              ? "Nothing on your plate right now — you're fully caught up."
              : `${openCount} open item${openCount === 1 ? "" : "s"} across your classes.`}
          </p>
        </div>
        {/* Phones have Record in the bottom tab bar. */}
        <Link
          href="/record"
          className="hidden flex-none items-center gap-2 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 lg:flex"
        >
          <span aria-hidden className="block h-2.5 w-2.5 rounded-full bg-white" />
          Record a lecture
        </Link>
      </div>

      {!hasAiConsent(user) && !(await cookies()).get(AI_NOT_NOW_COOKIE) && <AiConsentCard />}

      <RiskStatusCard risk={risk} />

      {inApp && (
        <NativeReminders
          timezone={user.timezone}
          deadlines={reminderDeadlines.map((a) => ({
            title: a.name,
            className: a.class.name,
            dueAt: (a.dueAt as Date).toISOString(),
          }))}
        />
      )}

      {pendingChangeCount > 0 && (
        <Link
          href="/email"
          className="mb-6 flex items-center justify-between rounded-xl2 border border-warn bg-warn-soft px-4 py-3 text-sm hover:brightness-95"
        >
          <span>
            <strong>{pendingChangeCount}</strong> email-derived change{pendingChangeCount === 1 ? "" : "s"} waiting on your decision
          </span>
          <span className="text-accent-ink">Review →</span>
        </Link>
      )}

      {/* One column on phones, in the order that matters there: the "what
          now" answer first, then the list, then the rest. Two columns on
          wide screens, with the list on the left. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <WhatNowPanel />
          <MinutesMode />
        </div>

        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {ranked.length === 0 ? (
            <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
              Nothing open right now. New assignments show up here after a Canvas sync.
            </div>
          ) : (
            SECTION_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
              <section key={bucket}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  {SECTION_TITLES[bucket]} <span className="font-normal">({assignmentCount(grouped.get(bucket)!)})</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  <ShowMore initial={5}>
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
                  </ShowMore>
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2">
          <WorkloadSummaryCard summary={summary} now={now} tz={user.timezone} />
          <AvailabilityCard blocks={availabilityBlocks} />
          <AskPanel />
        </div>
      </div>
    </AppShell>
  );
}

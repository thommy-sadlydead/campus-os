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
import { PageHeader } from "@/components/ui/PageHeader";
import { ArrowRightIcon, BookIcon, CalendarIcon, ChevronRightIcon, LayersIcon, MailIcon } from "@/components/icons";

const SECTION_TITLES: Record<UrgencyBucket, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  THIS_WEEK: "This week",
  LATER: "Later",
  NO_DATE: "No due date",
};

const SECTION_ORDER: UrgencyBucket[] = ["OVERDUE", "TODAY", "TOMORROW", "THIS_WEEK", "LATER", "NO_DATE"];

function greeting(now: Date, tz: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(now);
}

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
  const firstName = user.name?.trim().split(/\s+/)[0] ?? "";

  const grouped = new Map<UrgencyBucket, typeof ranked>();
  for (const r of ranked) {
    const list = grouped.get(r.bucket) ?? [];
    list.push(r);
    grouped.set(r.bucket, list);
  }

  // A brand-new account has nothing to rank yet; a green "on track" status
  // would be wrong, so it gets a welcome with the first step instead.
  if (classCount === 0) {
    const steps = [
      {
        Icon: LayersIcon,
        title: "Connect your classes",
        body: "From Canvas, Schoology, Brightspace or Blackboard. You'll paste a key or a calendar link, and the page shows you where to find it.",
      },
      {
        Icon: CalendarIcon,
        title: "Add your class times",
        body: "On the Schedule page, so Record knows which class you're in.",
      },
      {
        Icon: MailIcon,
        title: "Optional: connect your school email",
        body: "To catch due-date and room changes your professors send.",
      },
    ];
    return (
      <AppShell active="/dashboard" userName={user.name ?? user.email}>
        <div className="mx-auto max-w-xl pt-2 sm:pt-6">
          <div className="card card-pad relative overflow-hidden sm:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40"
              style={{
                background:
                  "radial-gradient(70% 100% at 10% 0%, var(--glow-1), transparent 70%), radial-gradient(60% 100% at 95% 0%, var(--glow-2), transparent 70%)",
              }}
            />
            <div className="relative">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ backgroundImage: "linear-gradient(135deg, var(--grad-from), var(--grad-to))" }}
              >
                <BookIcon className="h-[22px] w-[22px]" />
              </span>
              <p className="eyebrow mt-5">Welcome to Campus OS</p>
              <h1 className="mt-1.5 font-display text-2xl font-semibold text-ink sm:text-[28px]">Let&apos;s bring in your classes</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                Your dashboard is built from your school&apos;s course site: classes, assignments, due dates and
                more. Setting it up takes about a minute.
              </p>
              <ol className="mt-6 flex flex-col gap-4">
                {steps.map(({ Icon, title, body }, i) => (
                  <li key={title} className="flex gap-3.5">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-soft ring-1 ring-border-soft">
                      {i + 1}
                    </span>
                    <div className="pt-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <Icon className="h-4 w-4 text-ink-faint" />
                        {title}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link href="/connect" className="btn btn-primary btn-lg mt-7 w-full sm:w-auto">
                Connect your classes
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="/dashboard" userName={user.name ?? user.email}>
      <PageHeader
        eyebrow={todayLabel(now, user.timezone)}
        title={firstName ? `${greeting(now, user.timezone)}, ${firstName}` : greeting(now, user.timezone)}
        description={
          ranked.length === 0
            ? "Nothing on your plate right now — you're fully caught up."
            : `${openCount} open item${openCount === 1 ? "" : "s"} across your classes.`
        }
      />

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
          className="mb-6 flex items-center gap-3 rounded-xl2 bg-warn-soft px-4 py-3 text-sm text-warn transition-[filter] hover:brightness-[0.98]"
        >
          <MailIcon className="h-[18px] w-[18px] flex-none" />
          <span className="flex-1 text-ink">
            <strong className="font-semibold">{pendingChangeCount}</strong> email-derived change{pendingChangeCount === 1 ? "" : "s"} waiting on your decision
          </span>
          <span className="flex flex-none items-center gap-0.5 font-medium">
            Review
            <ChevronRightIcon className="h-4 w-4" />
          </span>
        </Link>
      )}

      {/* One column on phones, in the order that matters there: the "what
          now" answer first, then the list, then the rest. Two columns on
          wide screens, with the list on the left. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <WhatNowPanel />
          <MinutesMode />
        </div>

        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {ranked.length === 0 ? (
            <div className="empty">Nothing open right now. New assignments show up here after a sync.</div>
          ) : (
            SECTION_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
              <section key={bucket} className="card overflow-hidden">
                <header className="flex items-center justify-between border-b border-border-soft px-4 py-3 sm:px-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    {bucket === "OVERDUE" && <span aria-hidden className="dot bg-danger" />}
                    {SECTION_TITLES[bucket]}
                  </h2>
                  <span className="badge bg-surface-2 tabular-nums text-ink-soft">{assignmentCount(grouped.get(bucket)!)}</span>
                </header>
                <ul className="divide-y divide-border-soft">
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
                        lmsLink={r.item.lmsLink}
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

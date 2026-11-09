import { cookies, headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { TodayBoard, type TodayRow, type TodaySection } from "@/components/dashboard/TodayBoard";
import { WhatNowPanel } from "@/components/dashboard/WhatNowPanel";
import { AskPanel } from "@/components/dashboard/AskPanel";
import { RiskStatusCard } from "@/components/dashboard/RiskStatusCard";
import { NativeReminders } from "@/components/dashboard/NativeReminders";
import { AiConsentCard } from "@/components/account/AiConsent";
import { AI_NOT_NOW_COOKIE, hasAiConsent } from "@/lib/ai-consent";
import Link from "next/link";
import { loadWorkItemsForUser, getAvailableMinutesToday } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary, type UrgencyBucket } from "@/lib/priority-engine";
import { assessRisk } from "@/lib/risk-engine";
import { dueShort, heroDate } from "@/lib/today";
import { stripHtml } from "@/lib/text";
import { CheckOffNote } from "@/components/connect/CheckOffNote";
import { getConnections } from "@/lib/lms/connections";
import { namesWithoutSubmissionStatus } from "@/lib/lms/providers";
import { isDemoAccount } from "@/lib/sample-classes";
import { gmailOpenTo } from "@/lib/gmail-access";
import { SampleClassesButton } from "@/components/demo/SampleClassesButton";
import { ArrowRightIcon, BookIcon, CalendarIcon, ChevronRightIcon, LayersIcon, MailIcon } from "@/components/icons";
import { featuresFor } from "@/lib/features-server";
import { FeatureChooserCard } from "@/components/dashboard/FeatureChooserCard";
import { after } from "next/server";
import { refreshCanvasGrades } from "@/lib/grades-server";
import { gradeSlip, SLIP_WINDOW_DAYS } from "@/lib/grades";
import { weekBounds } from "@/lib/exam-prep";
import { StudyPlanCard } from "@/components/dashboard/StudyPlanCard";
import { ReviewDueCard } from "@/components/dashboard/ReviewDueCard";
import { GradeAlertsCard, type GradeAlert } from "@/components/dashboard/GradeAlertsCard";

// "Ask about everything" (askCrossAppAction) runs here: the study assistant
// can take a few rounds of lookups before writing a study guide, and stops
// gathering after 150 s (src/lib/study-agent/agent.ts), so it needs more
// than Vercel's default function duration.
export const maxDuration = 300;

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
  const week = weekBounds(now, user.timezone);
  // The iPhone app adds this to its user agent (capacitor.config.json); only
  // it can show reminders, so only it gets the deadlines for them.
  const inApp = (await headers()).get("user-agent")?.includes("CampusOSApp") ?? false;

  // Everything below needs only the signed-in user, so it's all asked for at
  // once: one wait on the database instead of several in a row (Today took
  // about a second on the server on Nov 9, 2026). The lookups behind a
  // feature wait only for the feature check. AppShell's own lookups (features,
  // the LMS link) are cached for the request, so they reuse these.
  const featured = featuresFor(user).then(async (features) => {
    const [planSessions, weekSessions, dueDecks, gradedClasses] = await Promise.all([
      features.has("exam-prep")
        ? prisma.studySession.findMany({
            where: {
              userId: user.id,
              status: "PLANNED",
              startsAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
              exam: { examAt: { gt: now } },
              class: { archived: false },
            },
            include: { class: { select: { name: true } }, exam: { select: { name: true } } },
            orderBy: { startsAt: "asc" },
            take: 8,
          })
        : Promise.resolve([]),
      features.has("exam-prep")
        ? prisma.studySession.findMany({ where: { userId: user.id, startsAt: { gte: week.start, lt: week.end } }, select: { status: true } })
        : Promise.resolve([]),
      features.has("smart-review")
        ? prisma.flashcardDeck.findMany({
            where: { class: { userId: user.id, archived: false } },
            select: { classId: true, class: { select: { name: true } }, _count: { select: { cards: { where: { dueAt: { lte: now } } } } } },
          })
        : Promise.resolve([]),
      features.has("grades")
        ? prisma.class.findMany({
            where: { userId: user.id, archived: false, gradePercent: { not: null } },
            select: {
              id: true,
              name: true,
              gradePercent: true,
              gradeTarget: true,
              officeHours: true,
              gradeSnapshots: { where: { takenAt: { gte: new Date(now.getTime() - SLIP_WINDOW_DAYS * 24 * 60 * 60 * 1000) } }, select: { percent: true, takenAt: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    return { features, planSessions, weekSessions, dueDecks, gradedClasses };
  });
  const [
    { features, planSessions, weekSessions, dueDecks, gradedClasses },
    items,
    availableMinutesToday,
    pendingChangeCount,
    classCount,
    reminderDeadlines,
    connections,
  ] = await Promise.all([
    featured,
    loadWorkItemsForUser(user.id),
    getAvailableMinutesToday(user.id, now, user.timezone),
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
    getConnections(user.id),
  ]);
  // Canvas grades change between syncs; refresh them after this page is sent (src/lib/grades-server.ts).
  if (features.has("grades")) after(() => refreshCanvasGrades(user.id));
  const reviewByClass = new Map<string, { classId: string; className: string; due: number }>();
  for (const d of dueDecks) {
    if (d._count.cards === 0) continue;
    const row = reviewByClass.get(d.classId) ?? { classId: d.classId, className: d.class.name, due: 0 };
    row.due += d._count.cards;
    reviewByClass.set(d.classId, row);
  }
  const gradeAlerts: GradeAlert[] = gradedClasses.flatMap((c) => {
    const slip = gradeSlip(c.gradePercent as number, c.gradeSnapshots, now, c.gradeTarget);
    return slip ? [{ classId: c.id, className: c.name, percent: c.gradePercent as number, slip, officeHours: c.officeHours }] : [];
  });
  const weekKept = weekSessions.filter((s) => s.status !== "SKIPPED");

  // For two weeks after connecting an LMS that doesn't say what's turned in
  // (Brightspace, Blackboard), a reminder that work here stays open until
  // it's checked off. The Assignments page always says so.
  const checkOffNames = namesWithoutSubmissionStatus(
    connections.filter((c) => now.getTime() - c.connectedAt.getTime() < 14 * 24 * 60 * 60 * 1000)
  );

  const ranked = rankWorkItems(items, now, user.timezone);
  const summary = computeWorkloadSummary(items, now, user.timezone, availableMinutesToday);
  const risk = assessRisk(ranked, summary, now, user.timezone);

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
      ...(gmailOpenTo(user.email)
        ? [
            {
              Icon: MailIcon,
              title: "Optional: connect your school email",
              body: "To catch due-date and room changes your professors send.",
            },
          ]
        : []),
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
                className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-surface"
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
              {!user.featuresChosenAt && (
                <p className="mt-4 text-sm text-ink-soft">
                  <Link href="/welcome?new=1" className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
                    Pick which features you want
                  </Link>{" "}
                  so Campus OS shows only what you&apos;ll use.
                </p>
              )}
              {isDemoAccount(user.email) && (
                <div className="mt-6 border-t border-border-soft pt-5">
                  <p className="mb-3 text-sm text-ink-soft">
                    This is the App Store review account. Fill it with made-up classes to try everything without a school
                    login.
                  </p>
                  <SampleClassesButton label="Add sample classes" />
                </div>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Every count on Today is of rows, the same rows the list shows: an
  // assignment broken into steps counts each step.
  const rows = (bucket: UrgencyBucket): TodayRow[] =>
    (grouped.get(bucket) ?? []).map((r) => ({
      id: r.item.id,
      kind: r.item.kind,
      title: r.item.title,
      classLabel: r.item.classCode?.trim() || r.item.className,
      className: r.item.className,
      dueShort: dueShort(bucket, r.item.dueAt, user.timezone),
      estimatedMinutes: r.item.estimatedMinutes,
      reason: r.reason,
      description: r.item.description ? stripHtml(r.item.description).trim() || null : null,
      lmsLink: r.item.lmsLink,
    }));
  const sections: TodaySection[] = SECTION_ORDER.filter((b) => b !== "OVERDUE" && grouped.has(b)).map((bucket) => ({
    key: bucket,
    title: SECTION_TITLES[bucket],
    rows: rows(bucket),
  }));
  const count = (bucket: UrgencyBucket) => grouped.get(bucket)?.length ?? 0;

  return (
    <AppShell active="/dashboard" userName={user.name ?? user.email}>
      {/* One column on phones; on wide screens the list on the left and the
          rest on the right. */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <TodayBoard
          dateLabel={heroDate(now, user.timezone)}
          dueToday={count("TODAY")}
          dueLaterThisWeek={count("TOMORROW") + count("THIS_WEEK")}
          overdue={rows("OVERDUE")}
          sections={sections}
          emptyText="Nothing on file right now. New assignments show up here after a sync."
        >
          {features.has("risk") && <RiskStatusCard risk={risk} />}
          <WhatNowPanel />
          {!user.featuresChosenAt && <FeatureChooserCard />}
          {!hasAiConsent(user) && !(await cookies()).get(AI_NOT_NOW_COOKIE) && <AiConsentCard />}
          {checkOffNames && <CheckOffNote names={checkOffNames} />}
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
          {features.has("email") && pendingChangeCount > 0 && (
            <Link
              href="/email"
              className="card flex items-center gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-surface-2"
            >
              <MailIcon className="h-[18px] w-[18px] flex-none text-ink-soft" />
              <span className="flex-1 text-ink">
                <strong className="font-semibold">{pendingChangeCount}</strong> email-derived change{pendingChangeCount === 1 ? "" : "s"} waiting on your decision
              </span>
              <span className="flex flex-none items-center gap-0.5 font-semibold">
                Review
                <ChevronRightIcon className="h-4 w-4" />
              </span>
            </Link>
          )}
        </TodayBoard>

        <div className="flex flex-col gap-3 lg:pt-1">
          {gradeAlerts.length > 0 && <GradeAlertsCard alerts={gradeAlerts} tz={user.timezone} helpOn={features.has("get-help")} />}
          {planSessions.length > 0 && (
            <StudyPlanCard
              sessions={planSessions.map((s) => ({
                id: s.id,
                classId: s.classId,
                className: s.class.name,
                examName: s.exam.name,
                startsAt: s.startsAt.toISOString(),
                minutes: s.minutes,
                status: s.status,
              }))}
              doneThisWeek={weekKept.filter((s) => s.status === "DONE").length}
              plannedThisWeek={weekKept.length}
              tz={user.timezone}
            />
          )}
          {reviewByClass.size > 0 && <ReviewDueCard classes={[...reviewByClass.values()]} />}
          {features.has("assistant") && <AskPanel />}
        </div>
      </div>
    </AppShell>
  );
}

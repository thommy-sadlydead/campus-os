// The Command Center's core logic: turns raw assignments/tasks into a
// ranked "what should I do" list, a single best-next recommendation, an
// "I have X minutes" match, and a workload summary.
//
// Deliberately pure / framework-free (no Prisma, no Next.js imports) so it
// can be unit tested directly — see tests/priority-engine.test.ts. The
// Prisma -> WorkItem mapping lives in src/lib/workload.ts.

import { hoursUntil, isSameTzDay } from "@/lib/time";

export type WorkStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "DONE";

export type UrgencyBucket = "OVERDUE" | "TODAY" | "TOMORROW" | "THIS_WEEK" | "LATER" | "NO_DATE";

export type PriorityColor = "red" | "orange" | "yellow" | "green" | "gray";

export interface WorkItem {
  id: string;
  /** For a bare assignment (no subtasks), this equals `id`. For a subtask, this points at its parent assignment. */
  assignmentId: string;
  kind: "assignment" | "task";
  title: string;
  className: string;
  classColor: number;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  pointsPossible: number | null;
  status: WorkStatus;
  isExamLinked: boolean;
}

export interface PriorityResult {
  item: WorkItem;
  score: number;
  bucket: UrgencyBucket;
  color: PriorityColor;
  reason: string;
}

const BUCKET_RANK: Record<UrgencyBucket, number> = {
  OVERDUE: 5,
  TODAY: 4,
  TOMORROW: 3,
  THIS_WEEK: 2,
  LATER: 1,
  NO_DATE: 0,
};

const BUCKET_COLOR: Record<UrgencyBucket, PriorityColor> = {
  OVERDUE: "red",
  TODAY: "red",
  TOMORROW: "orange",
  THIS_WEEK: "yellow",
  LATER: "green",
  NO_DATE: "gray",
};

export function classifyUrgency(dueAt: Date | null, now: Date, tz: string): UrgencyBucket {
  if (!dueAt) return "NO_DATE";
  if (dueAt.getTime() < now.getTime()) return "OVERDUE";
  if (isSameTzDay(dueAt, now, tz)) return "TODAY";
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (isSameTzDay(dueAt, tomorrow, tz)) return "TOMORROW";
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (dueAt.getTime() <= weekOut.getTime()) return "THIS_WEEK";
  return "LATER";
}

function isActionable(item: WorkItem): boolean {
  return item.status !== "DONE" && item.status !== "SUBMITTED" && item.status !== "GRADED";
}

function scoreItem(item: WorkItem, now: Date, tz: string): { score: number; bucket: UrgencyBucket } {
  const bucket = classifyUrgency(item.dueAt, now, tz);
  let score = BUCKET_RANK[bucket] * 100_000;

  if (item.dueAt) {
    // Within the same bucket, soonest-due wins — subtract hours-until-due
    // so a smaller (or negative, i.e. overdue) value scores higher.
    score -= hoursUntil(item.dueAt, now);
  }

  if (item.isExamLinked) score += 40; // exams carry weight beyond their own due date
  if (item.status === "IN_PROGRESS") score += 25; // nudge to finish what's started
  if (item.pointsPossible) score += Math.min(item.pointsPossible, 100) * 0.15;

  return { score, bucket };
}

function reasonFor(item: WorkItem, bucket: UrgencyBucket, now: Date): string {
  const parts: string[] = [];

  switch (bucket) {
    case "OVERDUE":
      parts.push("This is already past due");
      break;
    case "TODAY":
      parts.push("Due today — the most time-sensitive thing on your list");
      break;
    case "TOMORROW":
      parts.push("Due tomorrow, so there's limited runway left");
      break;
    case "THIS_WEEK":
      parts.push("Due later this week");
      break;
    case "LATER":
      parts.push("Not due soon, but worth chipping away at early");
      break;
    case "NO_DATE":
      parts.push("No due date on file, so this is a lower-urgency pick");
      break;
  }

  if (item.isExamLinked) parts.push("it's exam-related");
  if (item.status === "IN_PROGRESS") parts.push("you've already started it");
  if (item.estimatedMinutes != null) {
    parts.push(`estimated at ${item.estimatedMinutes} min`);
  }

  return parts.join(" — ");
}

/**
 * Rank all actionable items (undone assignments and tasks) by priority,
 * highest first. `tz` is the student's IANA timezone (User.timezone) —
 * required so "due today" means today in *their* timezone, not the
 * server's.
 */
export function rankWorkItems(items: WorkItem[], now: Date, tz: string): PriorityResult[] {
  return items
    .filter(isActionable)
    .map((item) => {
      const { score, bucket } = scoreItem(item, now, tz);
      return {
        item,
        score,
        bucket,
        color: BUCKET_COLOR[bucket],
        reason: reasonFor(item, bucket, now),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** The single best thing to work on right now. Null if there's nothing actionable. */
export function whatShouldIDoRightNow(items: WorkItem[], now: Date, tz: string): PriorityResult | null {
  const ranked = rankWorkItems(items, now, tz);
  return ranked[0] ?? null;
}

export interface FitResult {
  fits: true;
  result: PriorityResult;
}
export interface NoFitResult {
  fits: false;
  /** The highest-priority item overall, even though it doesn't fit — shown so the user knows what's being deferred. */
  closest: PriorityResult | null;
  message: string;
}

/**
 * Find the highest-priority item that can realistically be finished in
 * `minutes`. Never invents a fit: if the top-priority item is too big and
 * has no smaller subtask on record, says so plainly instead of picking
 * something irrelevant just to fill the slot.
 */
export function findBestFitForMinutes(
  items: WorkItem[],
  now: Date,
  tz: string,
  minutes: number
): FitResult | NoFitResult {
  const ranked = rankWorkItems(items, now, tz);
  const withEstimate = ranked.filter((r) => r.item.estimatedMinutes != null);

  const fitting = withEstimate.filter((r) => (r.item.estimatedMinutes as number) <= minutes);
  if (fitting.length > 0) {
    return { fits: true, result: fitting[0] };
  }

  const closest = ranked[0] ?? null;
  if (!closest) {
    return { fits: false, closest: null, message: "Nothing on your list right now." };
  }

  if (closest.item.estimatedMinutes == null) {
    return {
      fits: false,
      closest,
      message: `"${closest.item.title}" is the top priority, but it doesn't have a time estimate yet — add one, or break it into steps, to see if it fits.`,
    };
  }

  return {
    fits: false,
    closest,
    message: `Nothing fits cleanly in ${minutes} min. Your top priority, "${closest.item.title}", needs about ${closest.item.estimatedMinutes} min — consider breaking it into smaller steps.`,
  };
}

export interface WorkloadSummary {
  overdueCount: number;
  dueTodayCount: number;
  dueTomorrowCount: number;
  totalRemainingMinutesToday: number;
  itemsMissingEstimateToday: number;
  /** null when the user hasn't logged any free time for today — never fabricated. */
  availableMinutesToday: number | null;
  /** null unless availableMinutesToday is known. Positive = ahead, negative = behind. */
  aheadBehindMinutes: number | null;
  upcomingDeadlines: Array<{ id: string; title: string; className: string; dueAt: Date }>;
}

export function computeWorkloadSummary(
  items: WorkItem[],
  now: Date,
  tz: string,
  availableMinutesToday: number | null
): WorkloadSummary {
  const actionable = items.filter(isActionable);
  const overdueCount = actionable.filter((i) => i.dueAt && i.dueAt.getTime() < now.getTime()).length;
  const dueTodayCount = actionable.filter((i) => i.dueAt && isSameTzDay(i.dueAt, now, tz)).length;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dueTomorrowCount = actionable.filter((i) => i.dueAt && isSameTzDay(i.dueAt, tomorrow, tz)).length;

  const dueTodayOrOverdue = actionable.filter(
    (i) => i.dueAt && (i.dueAt.getTime() < now.getTime() || isSameTzDay(i.dueAt, now, tz))
  );
  const totalRemainingMinutesToday = dueTodayOrOverdue.reduce(
    (sum, i) => sum + (i.estimatedMinutes ?? 0),
    0
  );
  const itemsMissingEstimateToday = dueTodayOrOverdue.filter((i) => i.estimatedMinutes == null).length;

  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingDeadlines = actionable
    .filter((i) => i.dueAt && i.dueAt >= now && i.dueAt <= weekOut)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())
    .slice(0, 6)
    .map((i) => ({ id: i.id, title: i.title, className: i.className, dueAt: i.dueAt as Date }));

  const aheadBehindMinutes =
    availableMinutesToday == null ? null : availableMinutesToday - totalRemainingMinutesToday;

  return {
    overdueCount,
    dueTodayCount,
    dueTomorrowCount,
    totalRemainingMinutesToday,
    itemsMissingEstimateToday,
    availableMinutesToday,
    aheadBehindMinutes,
    upcomingDeadlines,
  };
}

/**
 * A rough, class-agnostic default estimate used only when nothing better
 * is available (no AI key configured, no user-entered estimate). Phase 3's
 * AI breakdown should supersede this whenever it has run.
 */
export function heuristicEstimateMinutes(input: {
  name: string;
  pointsPossible: number | null;
  description?: string | null;
}): number {
  const name = input.name.toLowerCase();
  if (/\b(final exam|final)\b/.test(name)) return 150;
  if (/\bmidterm|\bexam\b/.test(name)) return 100;
  if (/\bquiz\b/.test(name)) return 25;
  if (/\battendance\b/.test(name)) return 2;
  if (/\bpaper|essay|draft\b/.test(name)) return 90;
  if (/\breading\b/.test(name)) return 35;
  if (/\bpresentation\b/.test(name)) return 60;
  if (/\bhomework|problem set|hw\b/.test(name)) return 30;
  if (/\bdiscussion|response|reflection|journal\b/.test(name)) return 20;
  if (/\bproject\b/.test(name)) return 120;

  const pts = input.pointsPossible ?? 10;
  if (pts >= 100) return 90;
  if (pts >= 50) return 45;
  if (pts >= 20) return 30;
  return 15;
}

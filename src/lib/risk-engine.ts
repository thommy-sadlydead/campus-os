// The "Behind / At Risk" status — pure, dependency-free (no Prisma, no
// Next.js, no AI call) so it's unit-testable the same way
// priority-engine.ts is (see tests/risk-engine.test.ts). Takes the
// already-computed ranked list and workload summary rather than
// recomputing them, so this is purely a *judgment* layer on top of data
// the dashboard already has — never a second source of truth.
//
// Deliberately built from real signals only: overdue count, how many
// things are due soon, how far ahead/behind the student's own logged free
// time puts them (never fabricated — see priority-engine.ts), and how
// many exams are coming up. No AI is required to produce a real, honest
// status; askClaude (wired in from the dashboard action) is an optional
// narrative polish layer over this, exactly like "What should I do right
// now?" already works.

import type { PriorityResult, WorkloadSummary } from "@/lib/priority-engine";
import { formatDueLabel, formatMinutes } from "@/lib/time";

export type RiskLevel = "on-track" | "getting-behind" | "at-risk";

export const RISK_EMOJI: Record<RiskLevel, string> = {
  "on-track": "🟢",
  "getting-behind": "🟡",
  "at-risk": "🔴",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  "on-track": "On track",
  "getting-behind": "Getting behind",
  "at-risk": "At risk",
};

export interface RiskAssessment {
  level: RiskLevel;
  headline: string;
  /** Short, factual — capped at a handful so this never turns into a wall of text. */
  reasons: string[];
  /** 0-3 concrete next actions, ranked. Empty when on-track — a green status shouldn't nag. */
  recommendations: string[];
}

const RED_BEHIND_MINUTES = 60; // an hour or more behind logged free time
const RED_DUE_SOON_COUNT = 3; // three-plus things due within 48h, per the spec's own example
const DUE_SOON_WINDOW_HOURS = 48;
const EXAM_SOON_WINDOW_HOURS = 72;

export function assessRisk(ranked: PriorityResult[], summary: WorkloadSummary, now: Date, tz: string): RiskAssessment {
  const dueSoon = ranked.filter((r) => r.item.dueAt && hoursUntil(r.item.dueAt, now) <= DUE_SOON_WINDOW_HOURS);
  const examsSoon = ranked.filter(
    (r) => r.item.isExamLinked && r.item.dueAt && hoursUntil(r.item.dueAt, now) <= EXAM_SOON_WINDOW_HOURS && hoursUntil(r.item.dueAt, now) >= 0
  );
  const behindMinutes = summary.aheadBehindMinutes != null && summary.aheadBehindMinutes < 0 ? -summary.aheadBehindMinutes : 0;

  const isRed =
    summary.overdueCount > 0 ||
    behindMinutes >= RED_BEHIND_MINUTES ||
    dueSoon.length >= RED_DUE_SOON_COUNT ||
    (examsSoon.length > 0 && dueSoon.length >= 2);

  // A due-soon item is only a *yellow* signal on its own when we can't
  // confirm there's enough time for it — if the student has logged free
  // time and it comfortably covers today's workload, one thing due
  // tonight isn't "getting behind," it's just Tuesday. Exams get their
  // own signal regardless of the minute math, since exam prep quality
  // isn't something a task-completion estimate captures.
  const capacityUnknown = summary.availableMinutesToday == null;
  const isYellow =
    !isRed && (behindMinutes > 0 || (capacityUnknown && dueSoon.length >= 1) || examsSoon.length >= 1);

  const level: RiskLevel = isRed ? "at-risk" : isYellow ? "getting-behind" : "on-track";

  const reasons: string[] = [];
  if (summary.overdueCount > 0) {
    reasons.push(`${summary.overdueCount} item${summary.overdueCount === 1 ? " is" : "s are"} already overdue.`);
  }
  if (dueSoon.length > 0) {
    reasons.push(`${dueSoon.length} assignment${dueSoon.length === 1 ? "" : "s"} due within the next 48 hours.`);
  }
  if (examsSoon.length > 0) {
    reasons.push(`${examsSoon.length} exam${examsSoon.length === 1 ? "" : "s"} coming up in the next few days.`);
  }
  if (behindMinutes > 0) {
    reasons.push(`You're about ${formatMinutes(behindMinutes)} behind today's logged free time.`);
  }
  if (level === "on-track" && reasons.length === 0) {
    reasons.push(
      summary.availableMinutesToday == null
        ? "Nothing overdue and nothing piling up in the next 48 hours."
        : "You're keeping pace with today's logged free time."
    );
  }

  let headline: string;
  if (level === "at-risk" && behindMinutes >= RED_BEHIND_MINUTES) {
    headline = `You're currently about ${formatMinutes(behindMinutes)} behind your planned workload.`;
  } else if (level === "at-risk") {
    headline = `You're at risk of falling behind — ${dueSoon.length} things are due within 48 hours.`;
  } else if (level === "getting-behind") {
    headline = behindMinutes > 0 ? `You're a bit behind — about ${formatMinutes(behindMinutes)} so far today.` : "A few things are coming up worth getting ahead of.";
  } else {
    headline = "You're on track — nothing urgent piling up.";
  }

  // Recommendations reuse the same ranking the rest of the app already
  // trusts — never a second, possibly-inconsistent opinion about what to
  // do next. Capped at 2 (3 only when genuinely at-risk) per "don't
  // overwhelm the user, keep recommendations actionable" — and empty when
  // on-track, since a green status shouldn't nag with busywork.
  const recommendations: string[] = [];
  if (level !== "on-track" && ranked.length > 0) {
    const top = ranked.slice(0, level === "at-risk" ? 3 : 2);
    if (top.length === 1) {
      recommendations.push(`Focus on "${top[0].item.title}" (${top[0].item.className}) — ${formatDueLabel(top[0].item.dueAt, now, tz).toLowerCase()}.`);
    } else if (top.length >= 2) {
      const chain = top.map((r) => `"${r.item.title}"`).join(", then ");
      recommendations.push(`I'd recommend completing ${chain}.`);
    }
  }

  return { level, headline, reasons: reasons.slice(0, 4), recommendations };
}

function hoursUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

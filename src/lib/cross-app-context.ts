import "server-only";
import { prisma } from "@/lib/prisma";
import { loadWorkItemsForUser, getAvailableMinutesToday } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary } from "@/lib/priority-engine";
import { formatDueLabel, formatMinutes } from "@/lib/time";

/**
 * The full-picture context for the dashboard's cross-app assistant —
 * every class, not scoped to one. Built entirely from real data; the
 * prompt built on top of this is told never to add anything beyond it.
 */
export async function buildCrossAppPrompt(userId: string, tz: string): Promise<{ system: string; deterministicSummary: string }> {
  const now = new Date();

  const [items, availableMinutes, classes, pendingCount, recentEmails] = await Promise.all([
    loadWorkItemsForUser(userId),
    getAvailableMinutesToday(userId, now, tz),
    prisma.class.findMany({ where: { userId, archived: false } }),
    prisma.pendingChange.count({ where: { userId, status: "PENDING" } }),
    prisma.email.findMany({
      where: { userId, category: { notIn: ["IRRELEVANT", "UNCLASSIFIED"] } },
      orderBy: { receivedAt: "desc" },
      take: 10,
      include: { class: true },
    }),
  ]);

  const ranked = rankWorkItems(items, now, tz);
  const summary = computeWorkloadSummary(items, now, tz, availableMinutes);

  const workText =
    ranked
      .slice(0, 25)
      .map((r) => `- [${r.bucket}] ${r.item.title} (${r.item.className}) — ${formatDueLabel(r.item.dueAt, now, tz)}${r.item.estimatedMinutes != null ? `, ~${r.item.estimatedMinutes} min` : ""}`)
      .join("\n") || "(nothing open — fully caught up)";

  const classesText = classes.map((c) => `- ${c.name} (${c.code})`).join("\n") || "(no classes on file)";

  const emailsText =
    recentEmails
      .map((e) => `- [${e.category}] "${e.subject}" — ${e.class?.name ?? "unassigned"} (${e.receivedAt.toDateString()})`)
      .join("\n") || "(no relevant emails on file)";

  const system = [
    `You are the cross-class academic assistant for a college student. Today is ${now.toDateString()} (timezone: ${tz}).`,
    "Use ONLY the data below. Never invent a deadline, grade, class, or fact not present here.",
    "If asked about a specific class, focus your answer on that class's items but you may reference the overall workload for context.",
    "Be direct and concrete — this student wants to know what to actually do, not vague encouragement.",
    "",
    "=== CLASSES ===",
    classesText,
    "",
    "=== OPEN WORK (ranked by priority) ===",
    workText,
    "",
    "=== WORKLOAD SUMMARY ===",
    `Overdue: ${summary.overdueCount}. Due today: ${summary.dueTodayCount}. Due tomorrow: ${summary.dueTomorrowCount}.`,
    `Remaining work today: ${formatMinutes(summary.totalRemainingMinutesToday)}.`,
    summary.availableMinutesToday == null
      ? "Free time today: not tracked."
      : `Free time today: ${formatMinutes(summary.availableMinutesToday)}. Ahead/behind: ${summary.aheadBehindMinutes! >= 0 ? "+" : ""}${formatMinutes(Math.abs(summary.aheadBehindMinutes!))}.`,
    "",
    "=== RECENT RELEVANT EMAILS ===",
    emailsText,
    "",
    pendingCount > 0 ? `Note: there are ${pendingCount} email-derived change(s) awaiting the student's decision on the Email page.` : "",
  ].join("\n");

  const deterministicSummary = [
    ranked.length === 0
      ? "Nothing open right now — fully caught up."
      : `${ranked.length} open item(s). ${summary.overdueCount} overdue, ${summary.dueTodayCount} due today, ${summary.dueTomorrowCount} due tomorrow.`,
    summary.upcomingDeadlines.length > 0
      ? `Coming up: ${summary.upcomingDeadlines.map((d) => `${d.title} (${d.className}, ${formatDueLabel(d.dueAt, now, tz)})`).join("; ")}.`
      : "",
    summary.availableMinutesToday == null
      ? "Free time today isn't tracked — log it on the dashboard for an ahead/behind estimate."
      : `You're ${summary.aheadBehindMinutes! >= 0 ? "ahead" : "behind"} by ${formatMinutes(Math.abs(summary.aheadBehindMinutes!))} against today's logged free time.`,
    pendingCount > 0 ? `${pendingCount} email-derived change(s) are waiting on your decision on the Email page.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { system, deterministicSummary };
}

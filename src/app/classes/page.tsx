import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { courseInitials } from "@/lib/course-style";
import { meetingLabel, nextMeetingAt } from "@/lib/today";
import { loadWorkItemsForUser } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary, type WorkItem } from "@/lib/priority-engine";
import { assessRisk, type RiskAssessment } from "@/lib/risk-engine";
import { featuresFor } from "@/lib/features-server";
import { formatPercent } from "@/lib/grades";

export default async function ClassesPage() {
  const user = await requireUser();
  const features = await featuresFor(user);
  const now = new Date();

  const [classes, items] = await Promise.all([
    prisma.class.findMany({
      where: { userId: user.id, archived: false },
      include: {
        _count: {
          select: {
            assignments: true,
            exams: true,
            resources: true,
            // Same rule as the class page: everything but Canvas clutter.
            materials: { where: { OR: [{ syncStatus: null }, { syncStatus: { not: "SKIPPED_NOISE" } }] } },
          },
        },
        scheduleEvents: { select: { dayOfWeek: true, startMinute: true, startsOn: true, endsOn: true } },
      },
      orderBy: { name: "asc" },
    }),
    loadWorkItemsForUser(user.id),
  ]);

  const itemsByClassName = new Map<string, WorkItem[]>();
  for (const item of items) {
    const list = itemsByClassName.get(item.className) ?? [];
    list.push(item);
    itemsByClassName.set(item.className, list);
  }

  // Per-class Behind/At-Risk badge, reusing the same assessRisk logic the
  // dashboard trusts — never a separate, possibly-inconsistent opinion.
  // Free time is logged once for the whole day, not split per class, so
  // there's no honest per-class "minutes behind" figure to pass here;
  // availableMinutesToday is left null rather than fabricating a share of
  // it, and assessRisk already treats unknown capacity conservatively.
  const classRows: { cls: (typeof classes)[number]; risk: RiskAssessment; next: Date | null }[] = classes.map((c) => {
    const classItems = itemsByClassName.get(c.name) ?? [];
    const ranked = rankWorkItems(classItems, now, user.timezone);
    const summary = computeWorkloadSummary(classItems, now, user.timezone, null);
    return { cls: c, risk: assessRisk(ranked, summary, now, user.timezone), next: nextMeetingAt(c.scheduleEvents, now, user.timezone) };
  });
  // The class that meets next leads, as the black tile.
  const featured = classRows.reduce<(typeof classRows)[number] | null>(
    (best, row) => (row.next && (!best?.next || row.next < best.next) ? row : best),
    null
  );
  const ordered = featured ? [featured, ...classRows.filter((r) => r !== featured)] : classRows;

  return (
    <AppShell active="/classes" userName={user.name ?? user.email}>
      <header className="mb-6">
        <p className="eyebrow">{classRows.length} {classRows.length === 1 ? "class" : "classes"} this term</p>
        <h1 className="mt-1.5 font-display text-[40px] font-bold leading-[1.02] text-ink">Classes</h1>
      </header>

      {classRows.length === 0 ? (
        <div className="empty">
          <p className="display-num text-[56px] text-ink-faint">0</p>
          <p className="mt-3">
            No classes on file.{" "}
            <Link href="/connect" className="font-semibold text-ink underline decoration-border underline-offset-4">
              Connect your classes
            </Link>{" "}
            from Canvas, Schoology, Brightspace or Blackboard.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map(({ cls: c, risk, next }) => {
            const isFeatured = featured?.cls.id === c.id;
            return (
              <Link
                key={c.id}
                href={`/classes/${c.id}`}
                className={`card group flex flex-col p-5 transition-colors ${
                  isFeatured ? "theme-inverse sm:col-span-2" : "hover:border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span aria-hidden className="display-num text-[36px] text-ink">
                    {courseInitials(c.name)}
                  </span>
                  {features.has("risk") && <RiskBadge level={risk.level} />}
                </div>
                {isFeatured && next && (
                  <p className="eyebrow mt-4">Next class · {meetingLabel(next, now, user.timezone)}</p>
                )}
                <h2 className={`${isFeatured && next ? "mt-1" : "mt-4"} text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink`}>
                  {c.name}
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-faint">
                  {[c.code, c.professor].filter(Boolean).join(" · ") || "\u00a0"}
                </p>
                <div className="mt-auto grid grid-cols-3 gap-3 pt-6">
                  <Stat n={c._count.assignments} label="assignments" />
                  <Stat n={c._count.exams} label="exams" />
                  <Stat n={c._count.resources + c._count.materials} label="resources" />
                </div>
                {features.has("grades") && c.gradePercent != null && (
                  <p className="mt-4 border-t border-border-soft pt-3 text-[13px] text-ink-soft">
                    Grade <span className="font-semibold text-ink">{formatPercent(c.gradePercent)}</span>
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

/** A big number with its label underneath. */
function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="display-num text-[32px] text-ink">{n}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</p>
    </div>
  );
}

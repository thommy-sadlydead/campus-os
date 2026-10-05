import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { ChevronRightIcon } from "@/components/icons";
import { courseInitials, courseStyle } from "@/lib/course-style";
import { loadWorkItemsForUser } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary, type WorkItem } from "@/lib/priority-engine";
import { assessRisk, type RiskAssessment } from "@/lib/risk-engine";

export default async function ClassesPage() {
  const user = await requireUser();
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
  const classRows: { cls: (typeof classes)[number]; risk: RiskAssessment }[] = classes.map((c) => {
    const classItems = itemsByClassName.get(c.name) ?? [];
    const ranked = rankWorkItems(classItems, now, user.timezone);
    const summary = computeWorkloadSummary(classItems, now, user.timezone, null);
    return { cls: c, risk: assessRisk(ranked, summary, now, user.timezone) };
  });

  return (
    <AppShell active="/classes" userName={user.name ?? user.email}>
      <PageHeader
        title="Classes"
        description="Overview, assignments, notes, lectures, exams, resources, and a class-scoped AI assistant for each."
      />

      {classRows.length === 0 ? (
        <div className="empty">
          No classes yet.{" "}
          <Link href="/connect" className="font-medium text-accent-ink underline">
            Connect your classes
          </Link>{" "}
          from Canvas, Schoology, Brightspace or Blackboard.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classRows.map(({ cls: c, risk }) => (
            <Link
              key={c.id}
              href={`/classes/${c.id}`}
              className="card group flex flex-col p-5 transition-[border-color,box-shadow] hover:border-border hover:shadow-pop"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  aria-hidden
                  className="course-tint flex h-10 w-10 flex-none items-center justify-center rounded-xl text-sm font-semibold"
                  style={courseStyle(c.color)}
                >
                  {courseInitials(c.name)}
                </span>
                <RiskBadge level={risk.level} />
              </div>
              {c.code && <p className="eyebrow mt-4">{c.code}</p>}
              <h2 className={`${c.code ? "mt-1" : "mt-4"} text-base font-semibold leading-snug text-ink`}>{c.name}</h2>
              {(c.professor || c.room) && (
                <p className="mt-1 text-[13px] text-ink-soft">{[c.professor, c.room].filter(Boolean).join(" · ")}</p>
              )}
              <div className="mt-auto flex items-center gap-3 pt-5 text-[13px] text-ink-soft">
                <Count n={c._count.assignments} label="assignments" />
                <Count n={c._count.exams} label="exams" />
                <Count n={c._count.resources + c._count.materials} label="resources" />
                <ChevronRightIcon className="ml-auto h-4 w-4 flex-none text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold tabular-nums text-ink">{n}</span> {label}
    </span>
  );
}

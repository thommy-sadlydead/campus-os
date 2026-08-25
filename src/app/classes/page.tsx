import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { loadWorkItemsForUser } from "@/lib/workload";
import { rankWorkItems, computeWorkloadSummary, type WorkItem } from "@/lib/priority-engine";
import { assessRisk, RISK_EMOJI, RISK_LABEL, type RiskAssessment, type RiskLevel } from "@/lib/risk-engine";

const RISK_TONE: Record<RiskLevel, string> = {
  "on-track": "bg-ok-soft text-ok",
  "getting-behind": "bg-warn-soft text-warn",
  "at-risk": "bg-danger-soft text-danger",
};

export default async function ClassesPage() {
  const user = await requireUser();
  const now = new Date();

  const [classes, items] = await Promise.all([
    prisma.class.findMany({
      where: { userId: user.id, archived: false },
      include: {
        _count: { select: { assignments: true, exams: true, resources: true } },
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
      <h1 className="mb-1 font-display text-2xl font-semibold">Classes</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Overview, assignments, notes, lectures, exams, resources, and a class-scoped AI assistant for each.
      </p>

      {classRows.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No classes yet. Run <code className="font-mono">npm run db:seed</code> for demo data, or{" "}
          <code className="font-mono">npm run canvas:sync</code> for your real courses.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classRows.map(({ cls: c, risk }) => (
            <Link
              key={c.id}
              href={`/classes/${c.id}`}
              className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card transition-colors hover:border-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: `var(--c-${c.color})` }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{c.code}</span>
                </div>
                <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${RISK_TONE[risk.level]}`}>
                  {RISK_EMOJI[risk.level]} {RISK_LABEL[risk.level]}
                </span>
              </div>
              <h3 className="mt-1 font-display text-base font-semibold">{c.name}</h3>
              {(c.professor || c.room) && (
                <p className="mt-0.5 text-xs text-ink-soft">
                  {[c.professor, c.room].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-2 flex gap-3 text-xs text-ink-soft">
                <span>{c._count.assignments} assignments</span>
                <span>{c._count.exams} exams</span>
                <span>{c._count.resources} resources</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

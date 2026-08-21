import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";

export default async function ClassesPage() {
  const user = await requireUser();

  const classes = await prisma.class.findMany({
    where: { userId: user.id, archived: false },
    include: {
      _count: { select: { assignments: true, exams: true, resources: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell active="/classes" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Classes</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Overview, assignments, notes, exams, resources, and a class-scoped AI assistant for each.
      </p>

      {classes.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No classes yet. Run <code className="font-mono">npm run db:seed</code> for demo data, or{" "}
          <code className="font-mono">npm run canvas:sync</code> for your real courses.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/classes/${c.id}`}
              className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card transition-colors hover:border-accent"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: `var(--c-${c.color})` }}
                />
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{c.code}</span>
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

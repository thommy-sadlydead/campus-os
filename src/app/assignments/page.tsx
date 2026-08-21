import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { formatDueLabel, formatMinutes } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
};

const STATUS_TONE: Record<string, string> = {
  NOT_STARTED: "bg-surface-2 text-ink-soft",
  IN_PROGRESS: "bg-warn-soft text-warn",
  SUBMITTED: "bg-ok-soft text-ok",
  GRADED: "bg-ok-soft text-ok",
};

export default async function AssignmentsPage() {
  const user = await requireUser();
  const now = new Date();

  const assignments = await prisma.assignment.findMany({
    where: { class: { userId: user.id } },
    include: { class: true, tasks: true },
    orderBy: [{ dueAt: "asc" }],
  });

  return (
    <AppShell active="/assignments" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Assignments</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Every assignment across your classes — synced from Canvas, plus anything added by hand.
      </p>

      {assignments.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Nothing here yet. Run <code className="font-mono">npm run canvas:sync</code> to pull in your
          coursework.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl2 border border-border-soft bg-surface shadow-card">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-soft text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Assignment</th>
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Est. time</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const remainingTasks = a.tasks.filter((t) => !t.completed).length;
                return (
                  <tr key={a.id} className="border-b border-border-soft last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.name}</div>
                      {a.tasks.length > 0 && (
                        <div className="text-xs text-ink-faint">
                          {remainingTasks} of {a.tasks.length} step{a.tasks.length === 1 ? "" : "s"} left
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{a.class.name}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDueLabel(a.dueAt, now, user.timezone)}</td>
                    <td className="px-4 py-3 font-mono text-ink-soft">
                      {a.estimatedMinutes != null ? formatMinutes(a.estimatedMinutes) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[a.status]}`}
                      >
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

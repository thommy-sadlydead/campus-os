import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { AssignmentRow, type AssignmentRowStatus } from "@/components/assignments/AssignmentRow";
import { canvasAssignmentUrl } from "@/lib/canvas";

const COLUMN_COUNT = 5; // Assignment, Class, Due, Est. time, Status

export default async function AssignmentsPage() {
  const user = await requireUser();

  const assignments = await prisma.assignment.findMany({
    where: { class: { userId: user.id } },
    include: { class: true, tasks: { orderBy: { order: "asc" } } },
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
              {assignments.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={{
                    id: a.id,
                    name: a.name,
                    dueAt: a.dueAt?.toISOString() ?? null,
                    status: a.status as AssignmentRowStatus,
                    estimatedMinutes: a.estimatedMinutes,
                    description: a.description,
                    canvasUrl: canvasAssignmentUrl(a.class.canvasCourseId, a.canvasAssignmentId),
                    tasks: a.tasks.map((t) => ({
                      id: t.id,
                      title: t.title,
                      estimatedMinutes: t.estimatedMinutes,
                      completed: t.completed,
                    })),
                  }}
                  tz={user.timezone}
                  classLabel={a.class.name}
                  columnCount={COLUMN_COUNT}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

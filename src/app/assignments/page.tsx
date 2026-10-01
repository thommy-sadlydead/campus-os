import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
import type { AssignmentRowStatus } from "@/components/assignments/AssignmentRow";
import { AssignmentList } from "@/components/assignments/AssignmentList";
import { canvasAssignmentUrl } from "@/lib/canvas";

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
        Every assignment across your classes, from Canvas. Open one to see its directions, break it into steps, or mark it done.
      </p>

      {assignments.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Nothing here yet.{" "}
          <Link href="/canvas" className="font-medium text-accent-ink underline">
            Connect Canvas
          </Link>{" "}
          to bring in your assignments.
        </div>
      ) : (
        <AssignmentList
          showClass
          tz={user.timezone}
          assignments={assignments.map((a) => ({
            id: a.id,
            name: a.name,
            dueAt: a.dueAt?.toISOString() ?? null,
            status: a.status as AssignmentRowStatus,
            estimatedMinutes: a.estimatedMinutes,
            description: a.description,
            canvasUrl: canvasAssignmentUrl(a.class.canvasCourseId, a.canvasAssignmentId),
            classLabel: a.class.name,
            tasks: a.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              estimatedMinutes: t.estimatedMinutes,
              completed: t.completed,
            })),
          }))}
        />
      )}
    </AppShell>
  );
}

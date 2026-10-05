import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
import type { AssignmentRowStatus } from "@/components/assignments/AssignmentRow";
import { AssignmentList } from "@/components/assignments/AssignmentList";
import { lmsLink } from "@/lib/lms/providers";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckOffNote } from "@/components/connect/CheckOffNote";
import { getConnections } from "@/lib/lms/connections";
import { namesWithoutSubmissionStatus } from "@/lib/lms/providers";

export default async function AssignmentsPage() {
  const user = await requireUser();

  const [assignments, connections] = await Promise.all([
    prisma.assignment.findMany({
      where: { class: { userId: user.id, archived: false } },
      include: { class: true, tasks: { orderBy: { order: "asc" } } },
      orderBy: [{ dueAt: "asc" }],
    }),
    getConnections(user.id),
  ]);
  const checkOffNames = namesWithoutSubmissionStatus(connections.map((c) => c.provider));

  return (
    <AppShell active="/assignments" userName={user.name ?? user.email}>
      <PageHeader
        title="Assignments"
        description="Every assignment across your classes. Open one to see its directions, break it into steps, or mark it done."
      />

      {checkOffNames && assignments.length > 0 && <CheckOffNote names={checkOffNames} />}

      {assignments.length === 0 ? (
        <div className="empty">
          Nothing here yet.{" "}
          <Link href="/connect" className="font-medium text-accent-ink underline">
            Connect your classes
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
            lmsLink: lmsLink(a.lmsUrl, a.class.lmsProvider),
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

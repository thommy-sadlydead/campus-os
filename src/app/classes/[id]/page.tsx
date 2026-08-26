import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ClassTabs } from "@/components/classes/ClassTabs";
import { canvasAssignmentUrl } from "@/lib/canvas";
import type { AssignmentRowStatus } from "@/components/assignments/AssignmentRow";
import type { LectureRow, ClassMaterialRow } from "@/components/classes/LecturesPanel";

export default async function ClassPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const cls = await prisma.class.findUnique({
    where: { id: params.id },
    include: {
      scheduleEvents: true,
      assignments: { include: { tasks: { orderBy: { order: "asc" } } }, orderBy: { dueAt: "asc" } },
      exams: { orderBy: { examAt: "asc" } },
      resources: { orderBy: { addedAt: "desc" } },
      noteSections: {
        orderBy: { order: "asc" },
        include: { notes: { orderBy: { order: "asc" } } },
      },
      lectures: { orderBy: { createdAt: "desc" } },
      materials: { orderBy: { createdAt: "asc" } },
      emails: {
        where: { category: { notIn: ["IRRELEVANT", "UNCLASSIFIED"] } },
        orderBy: { receivedAt: "desc" },
        take: 5,
      },
    },
  });

  if (!cls || cls.userId !== user.id) notFound();

  const now = new Date();
  const nextAssignment = cls.assignments.find(
    (a) => a.dueAt && a.dueAt >= now && a.status !== "SUBMITTED" && a.status !== "GRADED"
  );
  const nextExam = cls.exams.find((e) => e.examAt && e.examAt >= now);

  return (
    <AppShell active="/classes" userName={user.name ?? user.email}>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="inline-block h-3 w-3 flex-none rounded-full" style={{ background: `var(--c-${cls.color})` }} />
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{cls.code}</div>
          <h1 className="font-display text-2xl font-semibold">{cls.name}</h1>
        </div>
      </div>

      <ClassTabs
        classInfo={{
          id: cls.id,
          code: cls.code,
          name: cls.name,
          professor: cls.professor,
          room: cls.room,
          currentGrade: cls.currentGrade,
          color: cls.color,
          nextAssignment: nextAssignment ? { title: nextAssignment.name, dueAt: nextAssignment.dueAt?.toISOString() ?? null } : null,
          nextExam: nextExam ? { title: nextExam.name, examAt: nextExam.examAt?.toISOString() ?? null } : null,
        }}
        scheduleEvents={cls.scheduleEvents.map((e) => ({
          id: e.id,
          dayOfWeek: e.dayOfWeek,
          startMinute: e.startMinute,
          endMinute: e.endMinute,
          location: e.location,
          label: e.label,
        }))}
        assignments={cls.assignments.map((a) => ({
          id: a.id,
          name: a.name,
          dueAt: a.dueAt?.toISOString() ?? null,
          status: a.status as AssignmentRowStatus,
          estimatedMinutes: a.estimatedMinutes,
          description: a.description,
          canvasUrl: canvasAssignmentUrl(cls.canvasCourseId, a.canvasAssignmentId),
          tasks: a.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            estimatedMinutes: t.estimatedMinutes,
            completed: t.completed,
          })),
        }))}
        noteSections={cls.noteSections.map((s) => ({
          id: s.id,
          name: s.name,
          order: s.order,
          notes: s.notes.map((n) => ({
            id: n.id,
            title: n.title,
            bodyMarkdown: n.bodyMarkdown,
            pinned: n.pinned,
            order: n.order,
            updatedAt: n.updatedAt.toISOString(),
          })),
        }))}
        lectures={cls.lectures.map((l) => ({
          id: l.id,
          title: l.title,
          status: l.status as LectureRow["status"],
          transcriptText: l.transcriptText,
          notesMarkdown: l.notesMarkdown,
          errorMessage: l.errorMessage,
          createdAt: l.createdAt.toISOString(),
        }))}
        materials={cls.materials.map((m) => ({
          id: m.id,
          type: m.type as ClassMaterialRow["type"],
          title: m.title,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))}
        exams={cls.exams.map((e) => ({
          id: e.id,
          name: e.name,
          examAt: e.examAt?.toISOString() ?? null,
          location: e.location,
          weight: e.weight,
          notes: e.notes,
        }))}
        resources={cls.resources.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          url: r.url,
          notes: r.notes,
          addedAt: r.addedAt.toISOString(),
        }))}
        recentEmails={cls.emails.map((e) => ({
          id: e.id,
          subject: e.subject,
          category: e.category,
          receivedAt: e.receivedAt.toISOString(),
          gmailMessageId: e.gmailMessageId,
        }))}
        tz={user.timezone}
      />
    </AppShell>
  );
}

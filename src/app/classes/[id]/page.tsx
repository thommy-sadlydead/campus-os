import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ClassTabs } from "@/components/classes/ClassTabs";
import { classTabFromParam } from "@/components/classes/class-tabs";
import { lmsLink } from "@/lib/lms/providers";
import { addMissingLectureNotes } from "@/lib/lecture-notes-sync";
import { defaultLectureTitle } from "@/lib/record-class";
import type { AssignmentRowStatus } from "@/components/assignments/AssignmentRow";
import type { LectureRow } from "@/components/classes/LecturesPanel";
import type { ClassMaterialRow } from "@/components/classes/ResourcesPanel";
import { ChevronLeftIcon } from "@/components/icons";
import { courseInitials, courseStyle } from "@/lib/course-style";
import { hasAiConsent } from "@/lib/ai-consent";
import { listConnectedApps } from "@/lib/oauth/oauth-server";
import { chatgptStudyPrompts } from "@/lib/flashcards";
import type { StudySourceOption } from "@/components/study/study-types";

// Server Actions invoked from this page (notably generateNotes, via
// pollLectureStatusAction/retryLectureAction in lecture-actions.ts) can now
// legitimately run for a couple minutes generating a full lecture's notes.
// Without this, Vercel's default function duration would kill the request
// well before that — the note generation call has its own 240s timeout, so
// this just needs to comfortably exceed it.
export const maxDuration = 300;

// How much of each book/slide file's text the page sends to the browser.
// The list only shows a line of it, and a big class can have hundreds of
// files, each up to 20,000 characters; the AI reads the full text on the
// server.
const MATERIAL_PREVIEW_CHARS = 280;

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { tab } = await searchParams;

  const owned = await prisma.class.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!owned) notFound();
  // Lectures from before lecture notes appeared in the Notes tab get their
  // notes added there the first time the class is opened.
  await addMissingLectureNotes(id);

  const cls = await prisma.class.findUnique({
    where: { id },
    include: {
      scheduleEvents: true,
      assignments: { include: { tasks: { orderBy: { order: "asc" } } }, orderBy: { dueAt: "asc" } },
      exams: { orderBy: { examAt: "asc" } },
      resources: { orderBy: { addedAt: "desc" } },
      noteSections: {
        orderBy: { order: "asc" },
        include: {
          notes: {
            orderBy: { order: "asc" },
            include: { lecture: { select: { id: true, createdAt: true } } },
          },
        },
      },
      lectures: {
        orderBy: { createdAt: "desc" },
        include: { notes: { select: { id: true, bodyMarkdown: true }, orderBy: { createdAt: "asc" }, take: 1 } },
      },
      // SKIPPED_NOISE is pure Canvas clutter (banner images, icons, etc.
      // discovered while scanning for real documents) that was never worth
      // showing a student — see canvas-materials-sync.ts. Everything else
      // (including FAILED/EXTERNAL/SKIPPED_TOO_LARGE/SKIPPED_UNSUPPORTED)
      // stays visible since each of those says something genuinely useful
      // ("we found this but couldn't read it"). The explicit null case is
      // needed because `not` alone also drops rows where syncStatus is
      // null, which is every material added by hand.
      materials: {
        where: { OR: [{ syncStatus: null }, { syncStatus: { not: "SKIPPED_NOISE" } }] },
        orderBy: { createdAt: "asc" },
      },
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

  // The Study tab: decks, what cards can be made from, and whether the
  // student has connected Campus OS in ChatGPT.
  const [decks, connectedApps] = await Promise.all([
    prisma.flashcardDeck.findMany({
      where: { classId: cls.id },
      include: { cards: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    listConnectedApps(user.id),
  ]);
  const notesWithText = cls.noteSections.flatMap((s) => s.notes).filter((n) => n.bodyMarkdown.trim());
  const readableMaterials = cls.materials.filter(
    (m) => (!m.syncStatus || m.syncStatus === "READY" || m.syncStatus === "EXTERNAL") && m.content.trim()
  );
  const studySources: StudySourceOption[] = [
    ...notesWithText.map((n) => ({ value: `note:${n.id}`, label: n.title, group: (n.lecture ? "Lecture notes" : "Notes") as StudySourceOption["group"] })),
    ...readableMaterials.map((m) => ({ value: `material:${m.id}`, label: m.title, group: "Course files" as const })),
  ];
  const latestLecture = cls.lectures.find((l) => l.status === "READY");

  return (
    <AppShell active="/classes" userName={user.name ?? user.email}>
      <div className="mb-6">
        <Link
          href="/classes"
          className="-ml-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Classes
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <span
            aria-hidden
            className="course-tint flex h-12 w-12 flex-none items-center justify-center rounded-xl2 text-base font-semibold"
            style={courseStyle(cls.color)}
          >
            {courseInitials(cls.name)}
          </span>
          <div className="min-w-0">
            {cls.code && <p className="eyebrow">{cls.code}</p>}
            <h1 className="font-display text-2xl font-semibold leading-tight text-ink sm:text-[28px]">{cls.name}</h1>
          </div>
        </div>
      </div>

      <ClassTabs
        initialTab={classTabFromParam(tab)}
        classInfo={{
          id: cls.id,
          code: cls.code,
          name: cls.name,
          professor: cls.professor,
          room: cls.room,
          currentGrade: cls.currentGrade,
          color: cls.color,
          lmsProvider: cls.lmsProvider,
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
          lmsLink: lmsLink(a.lmsUrl, cls.lmsProvider),
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
            lecture: n.lecture ? { id: n.lecture.id, createdAt: n.lecture.createdAt.toISOString() } : null,
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
          note: l.notes[0] ? { id: l.notes[0].id, bodyMarkdown: l.notes[0].bodyMarkdown } : null,
        }))}
        defaultLectureTitle={defaultLectureTitle(now, user.timezone)}
        materials={cls.materials.map((m) => ({
          id: m.id,
          type: m.type as ClassMaterialRow["type"],
          title: m.title,
          preview: m.content.slice(0, MATERIAL_PREVIEW_CHARS),
          sourceUrl: m.sourceUrl,
          createdAt: m.createdAt.toISOString(),
          provider: m.provider,
          syncStatus: m.syncStatus,
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
        study={{
          decks: decks.map((d) => ({
            id: d.id,
            title: d.title,
            source: d.source,
            createdAt: d.createdAt.toISOString(),
            cards: d.cards.map((c) => ({ id: c.id, front: c.front, back: c.back, known: c.known })),
          })),
          sources: studySources,
          hasMaterial: studySources.length > 0,
          aiAllowed: hasAiConsent(user),
          chatgpt: {
            connected: connectedApps.some((app) => new URL(app.clientId).hostname === "chatgpt.com"),
            connectUrl: process.env.CHATGPT_PLUGIN_URL?.trim() || null,
            prompts: chatgptStudyPrompts({ className: cls.name, nextExam: nextExam?.name, latestLecture: latestLecture?.title }),
          },
        }}
        tz={user.timezone}
      />
    </AppShell>
  );
}

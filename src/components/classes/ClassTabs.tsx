"use client";

import { useState } from "react";
import { NotesBoard, type NotesBoardSection } from "@/components/notes/NotesBoard";
import { OverviewPanel, type OverviewClassInfo, type OverviewScheduleEvent, type OverviewEmail } from "@/components/classes/OverviewPanel";
import { ClassAssignmentsPanel, type ClassAssignmentRow } from "@/components/classes/ClassAssignmentsPanel";
import { ExamsPanel, type ExamRow } from "@/components/classes/ExamsPanel";
import { ResourcesPanel, type ResourceRow, type ClassMaterialRow } from "@/components/classes/ResourcesPanel";
import { LecturesPanel, type LectureRow } from "@/components/classes/LecturesPanel";
import { ClassAssistant } from "@/components/classes/ClassAssistant";
import { CLASS_TABS, type ClassTab } from "@/components/classes/class-tabs";

export function ClassTabs({
  initialTab,
  classInfo,
  scheduleEvents,
  assignments,
  noteSections,
  lectures,
  defaultLectureTitle,
  materials,
  exams,
  resources,
  recentEmails,
  tz,
}: {
  initialTab: ClassTab;
  classInfo: OverviewClassInfo;
  scheduleEvents: OverviewScheduleEvent[];
  assignments: ClassAssignmentRow[];
  noteSections: NotesBoardSection[];
  lectures: LectureRow[];
  defaultLectureTitle: string;
  materials: ClassMaterialRow[];
  exams: ExamRow[];
  resources: ResourceRow[];
  recentEmails: OverviewEmail[];
  tz: string;
}) {
  const [tab, setTab] = useState<ClassTab>(initialTab);
  // Set when one tab sends you to a specific item in another: a lecture's
  // "Edit in Notes", or a lecture note's "From lecture" link.
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [focusLectureId, setFocusLectureId] = useState<string | null>(null);
  const noteCount = noteSections.reduce((s, sec) => s + sec.notes.length, 0);
  // What note generation can actually read (same rule as MATERIALS_WITH_TEXT
  // in src/lib/class-context.ts): hand-added, imported, or external links.
  const usableMaterialCount = materials.filter(
    (m) => !m.syncStatus || m.syncStatus === "READY" || m.syncStatus === "EXTERNAL"
  ).length;

  const counts: Partial<Record<ClassTab, number>> = {
    Assignments: assignments.length,
    Notes: noteCount,
    Lectures: lectures.length,
    Exams: exams.length,
    Resources: materials.length + resources.length,
  };

  // Deliberately doesn't write ?tab= back to the address bar: Next.js treats
  // history.replaceState as a navigation, and a navigation throws away any
  // refresh still in flight, so switching tabs right after an action (say,
  // deleting a note) would leave the other tab showing stale data. ?tab= is
  // read once, for links into a tab (/record, the Canvas page).
  function go(next: ClassTab) {
    setTab(next);
    setFocusNoteId(null);
    setFocusLectureId(null);
  }

  return (
    <div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border-soft">
        {CLASS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => go(t)}
            className={`flex-none whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t}
            {counts[t] != null && <span className="ml-1.5 text-xs text-ink-faint">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <OverviewPanel classInfo={classInfo} scheduleEvents={scheduleEvents} recentEmails={recentEmails} tz={tz} />
      )}
      {tab === "Assignments" && <ClassAssignmentsPanel assignments={assignments} tz={tz} />}
      {tab === "Notes" && (
        <NotesBoard
          classId={classInfo.id}
          sections={noteSections}
          focusNoteId={focusNoteId}
          onViewLecture={(lectureId) => {
            go("Lectures");
            setFocusLectureId(lectureId);
          }}
        />
      )}
      {tab === "Lectures" && (
        <LecturesPanel
          classId={classInfo.id}
          lectures={lectures}
          defaultTitle={defaultLectureTitle}
          materialCount={usableMaterialCount}
          focusLectureId={focusLectureId}
          onOpenNote={(noteId) => {
            go("Notes");
            setFocusNoteId(noteId);
          }}
          onOpenResources={() => go("Resources")}
        />
      )}
      {tab === "Exams" && <ExamsPanel exams={exams} tz={tz} />}
      {tab === "Resources" && <ResourcesPanel classId={classInfo.id} resources={resources} materials={materials} />}

      <div className="mt-8">
        <ClassAssistant classId={classInfo.id} className={classInfo.name} />
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { NotesBoard, type NotesBoardSection } from "@/components/notes/NotesBoard";
import { OverviewPanel, type OverviewClassInfo, type OverviewScheduleEvent, type OverviewEmail } from "@/components/classes/OverviewPanel";
import { ClassAssignmentsPanel, type ClassAssignmentRow } from "@/components/classes/ClassAssignmentsPanel";
import { ExamsPanel, type ExamRow } from "@/components/classes/ExamsPanel";
import { ResourcesPanel, type ResourceRow } from "@/components/classes/ResourcesPanel";
import { ClassAssistant } from "@/components/classes/ClassAssistant";

const TABS = ["Overview", "Assignments", "Notes", "Exams", "Resources"] as const;
type Tab = (typeof TABS)[number];

export function ClassTabs({
  classInfo,
  scheduleEvents,
  assignments,
  noteSections,
  exams,
  resources,
  recentEmails,
  tz,
}: {
  classInfo: OverviewClassInfo;
  scheduleEvents: OverviewScheduleEvent[];
  assignments: ClassAssignmentRow[];
  noteSections: NotesBoardSection[];
  exams: ExamRow[];
  resources: ResourceRow[];
  recentEmails: OverviewEmail[];
  tz: string;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const noteCount = noteSections.reduce((s, sec) => s + sec.notes.length, 0);

  const counts: Partial<Record<Tab, number>> = {
    Assignments: assignments.length,
    Notes: noteCount,
    Exams: exams.length,
    Resources: resources.length,
  };

  return (
    <div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border-soft">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
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
      {tab === "Notes" && <NotesBoard classId={classInfo.id} sections={noteSections} />}
      {tab === "Exams" && <ExamsPanel exams={exams} tz={tz} />}
      {tab === "Resources" && <ResourcesPanel classId={classInfo.id} resources={resources} />}

      <div className="mt-8">
        <ClassAssistant classId={classInfo.id} className={classInfo.name} />
      </div>
    </div>
  );
}

import { formatDueLabel, formatMinutes } from "@/lib/time";

export interface ClassAssignmentRow {
  id: string;
  name: string;
  dueAt: string | null;
  pointsPossible: number | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  estimatedMinutes: number | null;
  taskCount: number;
  taskRemaining: number;
}

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

export function ClassAssignmentsPanel({ assignments, tz }: { assignments: ClassAssignmentRow[]; tz: string }) {
  const now = new Date();

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        No assignments synced for this class yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl2 border border-border-soft bg-surface shadow-card">
      <table className="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-soft text-left text-xs uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-3 font-medium">Assignment</th>
            <th className="px-4 py-3 font-medium">Due</th>
            <th className="px-4 py-3 font-medium">Est. time</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} className="border-b border-border-soft last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium">{a.name}</div>
                {a.taskCount > 0 && (
                  <div className="text-xs text-ink-faint">
                    {a.taskRemaining} of {a.taskCount} step{a.taskCount === 1 ? "" : "s"} left
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-ink-soft">{formatDueLabel(a.dueAt ? new Date(a.dueAt) : null, now, tz)}</td>
              <td className="px-4 py-3 font-mono text-ink-soft">{a.estimatedMinutes != null ? formatMinutes(a.estimatedMinutes) : "—"}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

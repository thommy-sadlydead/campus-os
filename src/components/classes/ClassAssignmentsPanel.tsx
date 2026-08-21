import { AssignmentRow, type AssignmentRowData } from "@/components/assignments/AssignmentRow";

export interface ClassAssignmentRow extends AssignmentRowData {}

const COLUMN_COUNT = 4; // Assignment, Due, Est. time, Status

export function ClassAssignmentsPanel({ assignments, tz }: { assignments: ClassAssignmentRow[]; tz: string }) {
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
            <AssignmentRow key={a.id} assignment={a} tz={tz} columnCount={COLUMN_COUNT} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

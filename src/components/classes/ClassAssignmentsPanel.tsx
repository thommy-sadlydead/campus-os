import type { AssignmentRowData } from "@/components/assignments/AssignmentRow";
import { AssignmentList } from "@/components/assignments/AssignmentList";

export interface ClassAssignmentRow extends AssignmentRowData {}

export function ClassAssignmentsPanel({ assignments, tz }: { assignments: ClassAssignmentRow[]; tz: string }) {
  if (assignments.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        No assignments for this class yet. They come in from Canvas.
      </div>
    );
  }

  return <AssignmentList assignments={assignments} tz={tz} showClass={false} />;
}

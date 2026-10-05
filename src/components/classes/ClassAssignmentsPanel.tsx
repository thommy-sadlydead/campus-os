import type { AssignmentRowData } from "@/components/assignments/AssignmentRow";
import { AssignmentList } from "@/components/assignments/AssignmentList";

export interface ClassAssignmentRow extends AssignmentRowData {}

export function ClassAssignmentsPanel({ assignments, tz }: { assignments: ClassAssignmentRow[]; tz: string }) {
  if (assignments.length === 0) {
    return (
      <div className="empty">
        No assignments for this class yet. They come in when you sync your classes.
      </div>
    );
  }

  return <AssignmentList assignments={assignments} tz={tz} showClass={false} />;
}

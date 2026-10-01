import { groupAssignments } from "@/lib/assignment-groups";
import { ShowMore } from "@/components/ShowMore";
import { AssignmentRow, type AssignmentRowData } from "./AssignmentRow";
import { assignmentGridColumns } from "./assignment-grid";

export interface AssignmentListItem extends AssignmentRowData {
  /** Shown on the all-classes Assignments page; left out inside a class. */
  classLabel?: string;
}

/**
 * Assignments in the order a student needs them: what's overdue, then
 * what's coming up (soonest first), with finished work folded away at the
 * bottom instead of filling the top of the list.
 */
export function AssignmentList({ assignments, tz, showClass }: { assignments: AssignmentListItem[]; tz: string; showClass: boolean }) {
  const { overdue, upcoming, done } = groupAssignments(assignments, new Date());

  const row = (a: AssignmentListItem) => (
    <AssignmentRow key={a.id} assignment={a} tz={tz} classLabel={showClass ? a.classLabel ?? "" : undefined} />
  );

  const header = (
    <div
      className={`hidden border-b border-border-soft px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink-faint lg:grid lg:gap-x-4 ${assignmentGridColumns(showClass)}`}
    >
      <span>Assignment</span>
      {showClass && <span>Class</span>}
      <span>Due</span>
      <span>Est. time</span>
      <span>Status</span>
    </div>
  );

  const group = (title: string, items: AssignmentListItem[], initial: number) =>
    items.length > 0 && (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {title} <span className="font-normal">({items.length})</span>
        </h2>
        <div className="rounded-xl2 border border-border-soft bg-surface shadow-card">
          {header}
          <ul>
            <ShowMore initial={initial}>{items.map(row)}</ShowMore>
          </ul>
        </div>
      </section>
    );

  return (
    <div className="flex flex-col gap-6">
      {group("Overdue", overdue, 5)}
      {group("Coming up", upcoming, 15)}
      {overdue.length === 0 && upcoming.length === 0 && (
        <p className="rounded-xl2 border border-dashed border-border p-6 text-center text-sm text-ink-soft">
          Nothing left to do here.
        </p>
      )}
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-faint hover:text-ink">
            Done <span className="font-normal">({done.length})</span>
          </summary>
          <div className="mt-2 rounded-xl2 border border-border-soft bg-surface shadow-card">
            {header}
            <ul>
              <ShowMore initial={15}>{done.map(row)}</ShowMore>
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

import { groupAssignments } from "@/lib/assignment-groups";
import { ShowMore } from "@/components/ShowMore";
import { AssignmentRow, type AssignmentRowData } from "./AssignmentRow";
import { assignmentGridColumns } from "./assignment-grid";
import { ChevronRightIcon } from "@/components/icons";

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
      className={`hidden border-b border-border-soft bg-surface-2 px-5 py-2.5 lg:grid lg:gap-x-4 ${assignmentGridColumns(showClass)}`}
    >
      <span className="eyebrow pl-[22px]">Assignment</span>
      {showClass && <span className="eyebrow">Class</span>}
      <span className="eyebrow">Due</span>
      <span className="eyebrow">Est. time</span>
      <span className="eyebrow">Status</span>
    </div>
  );

  const group = (title: string, items: AssignmentListItem[], initial: number, tone?: "danger") =>
    items.length > 0 && (
      <section className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-border-soft px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            {tone === "danger" && <span aria-hidden className="dot bg-danger" />}
            {title}
          </h2>
          <span className="badge bg-surface-2 tabular-nums text-ink-soft">{items.length}</span>
        </header>
        {header}
        <ul>
          <ShowMore initial={initial}>{items.map(row)}</ShowMore>
        </ul>
      </section>
    );

  return (
    <div className="flex flex-col gap-6">
      {group("Overdue", overdue, 5, "danger")}
      {group("Coming up", upcoming, 15)}
      {overdue.length === 0 && upcoming.length === 0 && (
        <p className="empty">
          Nothing left to do here.
        </p>
      )}
      {done.length > 0 && (
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-3 hover:bg-surface-2 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ChevronRightIcon className="h-4 w-4 text-ink-faint transition-transform group-open:rotate-90" />
              Done
            </span>
            <span className="badge bg-surface-2 tabular-nums text-ink-soft">{done.length}</span>
          </summary>
          <div className="border-t border-border-soft">
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

// Splits an assignment list into what the Assignments views show: what's
// overdue, what's coming up, and what's finished. Pure, so it's testable.

export type AssignmentGroupStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export interface GroupableAssignment {
  dueAt: string | null; // ISO
  status: AssignmentGroupStatus;
}

export interface AssignmentGroups<T> {
  overdue: T[]; // not done, due date passed; most recently due first
  upcoming: T[]; // not done, due later or undated; soonest first, undated last
  done: T[]; // submitted or graded; most recently due first
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

export function groupAssignments<T extends GroupableAssignment>(items: T[], now: Date): AssignmentGroups<T> {
  const nowMs = now.getTime();
  const done: T[] = [];
  const overdue: T[] = [];
  const upcoming: T[] = [];
  for (const item of items) {
    if (item.status === "SUBMITTED" || item.status === "GRADED") done.push(item);
    else if (item.dueAt && time(item.dueAt) < nowMs) overdue.push(item);
    else upcoming.push(item);
  }
  overdue.sort((a, b) => time(b.dueAt) - time(a.dueAt));
  upcoming.sort((a, b) => time(a.dueAt) - time(b.dueAt));
  // Undated finished work sorts after dated work rather than first.
  done.sort((a, b) => (b.dueAt ? time(b.dueAt) : -Infinity) - (a.dueAt ? time(a.dueAt) : -Infinity));
  return { overdue, upcoming, done };
}

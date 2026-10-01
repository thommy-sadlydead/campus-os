// The column layout assignment rows line up with on wide screens, with or
// without the Class column. A plain module (no "use client") because both
// AssignmentRow (client) and AssignmentList (server, on /assignments) call
// it; a server component can't call a function exported from a client file.
export function assignmentGridColumns(withClass: boolean): string {
  return withClass
    ? "lg:grid-cols-[minmax(0,1fr)_11rem_10rem_6.5rem_7rem]"
    : "lg:grid-cols-[minmax(0,1fr)_10rem_6.5rem_7rem]";
}

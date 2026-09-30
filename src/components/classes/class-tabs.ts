// The class page's tabs. A plain module (no "use client") so the page can
// read ?tab= on the server and ClassTabs can render the same list.
export const CLASS_TABS = ["Overview", "Assignments", "Notes", "Lectures", "Exams", "Resources"] as const;
export type ClassTab = (typeof CLASS_TABS)[number];

/** "lectures" -> "Lectures"; anything unknown falls back to Overview. */
export function classTabFromParam(param: string | undefined): ClassTab {
  return CLASS_TABS.find((t) => t.toLowerCase() === param?.toLowerCase()) ?? "Overview";
}

// What a sync found, kept on the connection (CanvasAccount.lastSyncReport,
// LmsConnection.lastSyncReport) and shown on its Connect page, so a student
// can see which classes came in and why any didn't. Pure, so client
// components can format it too.

import type { LmsProvider } from "@/lib/lms/providers";

export interface ClassSyncResult {
  name: string;
  /** Assignments the LMS listed for this class (0 when they couldn't be loaded). */
  assignments: number;
  /** How many of those were new this sync. */
  newAssignments: number;
  exams: number;
  /** Why this class's assignments couldn't be loaded or saved; the class itself still synced when it could. */
  problem?: string;
}

export interface SyncReport {
  provider: LmsProvider;
  finishedAt: string;
  classes: ClassSyncResult[];
  /** Courses the LMS listed that weren't synced, and why. */
  skipped: { name: string; reason: string }[];
  /** Assignments opened again because the LMS says they haven't been turned in (see src/lib/lms/status.ts). */
  reopened: { className: string; name: string }[];
  /** New deadlines that came in checked off: already past, and the LMS doesn't say what was turned in. */
  checkedOff?: number;
  /** Set when the whole sync failed; the rest is then empty. */
  error?: string;
}

export function emptyReport(provider: LmsProvider, now: Date): SyncReport {
  return { provider, finishedAt: now.toISOString(), classes: [], skipped: [], reopened: [] };
}

export function failedReport(provider: LmsProvider, now: Date, error: string): SyncReport {
  return { ...emptyReport(provider, now), error };
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

/** One line for the Sync button: "Synced 84 assignments across 6 classes." */
export function summarizeReport(report: SyncReport): string {
  if (report.error) return report.error;
  const assignments = report.classes.reduce((sum, c) => sum + c.assignments, 0);
  const problems = report.classes.filter((c) => c.problem).length + report.skipped.length;
  const base = `Synced ${plural(assignments, "assignment")} across ${plural(report.classes.length, "class", "classes")}.`;
  return problems > 0 ? `${base} ${plural(problems, "course")} need${problems === 1 ? "s" : ""} a look.` : base;
}

/** The stored report, or null when there isn't one (or it's unreadable). */
export function parseReport(json: string | null | undefined): SyncReport | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<SyncReport>;
    if (!value || typeof value !== "object" || typeof value.finishedAt !== "string") return null;
    return {
      provider: value.provider as LmsProvider,
      finishedAt: value.finishedAt,
      classes: Array.isArray(value.classes) ? value.classes : [],
      skipped: Array.isArray(value.skipped) ? value.skipped : [],
      reopened: Array.isArray(value.reopened) ? value.reopened : [],
      ...(typeof value.checkedOff === "number" && value.checkedOff > 0 ? { checkedOff: value.checkedOff } : {}),
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  } catch {
    return null;
  }
}

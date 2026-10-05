import { AlertIcon, CheckCircleIcon } from "@/components/icons";
import { CardHeader } from "@/components/ui/CardHeader";
import { formatPastMoment } from "@/lib/time";
import type { SyncReport } from "@/lib/lms/report";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * What the last sync brought in, class by class, and why anything didn't
 * come in: a course the LMS isn't showing yet, an invitation not accepted,
 * assignments that couldn't be loaded. Shown on each Connect page.
 */
export function SyncReportCard({
  report,
  lmsName,
  tz,
  footnote,
}: {
  report: SyncReport | null;
  lmsName: string;
  tz: string;
  footnote?: React.ReactNode;
}) {
  if (!report) return null;

  const needsLook = !!report.error || report.skipped.length > 0 || report.classes.some((c) => c.problem);
  const finished = formatPastMoment(new Date(report.finishedAt), new Date(), tz);

  return (
    <div className="card card-pad mb-6">
      <CardHeader
        icon={
          needsLook ? (
            <AlertIcon className="h-[18px] w-[18px] text-warn" />
          ) : (
            <CheckCircleIcon className="h-[18px] w-[18px] text-ok" />
          )
        }
        title="Last sync"
        description={`Finished ${finished}`}
      />

      {report.error ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{report.error}</p>
      ) : report.classes.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          {lmsName} didn&apos;t list any current courses for this account.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border-soft border-t border-border-soft">
          {report.classes.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
              {/* A class whose assignments couldn't be loaded shows the reason instead of "0 assignments". */}
              {(!c.problem || c.assignments > 0) && (
                <span className="flex-none text-[13px] tabular-nums text-ink-faint">
                  {plural(c.assignments, "assignment")}
                  {c.exams > 0 && ` · ${plural(c.exams, "exam")}`}
                  {c.newAssignments > 0 && ` · ${c.newAssignments} new`}
                </span>
              )}
              {c.problem && <span className="text-[13px] text-warn sm:max-w-xs sm:flex-none sm:text-right">{c.problem}</span>}
            </li>
          ))}
        </ul>
      )}

      {report.skipped.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Not synced</p>
          <ul className="flex flex-col gap-2">
            {report.skipped.map((s, i) => (
              <li key={`${s.name}-${i}`} className="text-sm">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-ink-soft"> — {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.reopened.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Back on your list</p>
          <p className="text-sm text-ink-soft">
            {lmsName} says you haven&apos;t turned {report.reopened.length === 1 ? "this" : "these"} in yet, so{" "}
            {report.reopened.length === 1 ? "it's" : "they're"} open again:
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {report.reopened.map((r, i) => (
              <li key={`${r.name}-${i}`} className="text-ink">
                {r.name} <span className="text-ink-faint">· {r.className}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {footnote && <p className="mt-5 border-t border-border-soft pt-4 text-xs leading-relaxed text-ink-faint">{footnote}</p>}
    </div>
  );
}

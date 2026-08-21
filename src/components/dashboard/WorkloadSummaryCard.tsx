import { formatMinutes, formatDueLabel } from "@/lib/time";
import type { WorkloadSummary } from "@/lib/priority-engine";

export function WorkloadSummaryCard({
  summary,
  now,
  tz,
}: {
  summary: WorkloadSummary;
  now: Date;
  tz: string;
}) {
  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">Today's workload</h3>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label="Overdue" value={summary.overdueCount} tone={summary.overdueCount > 0 ? "danger" : undefined} />
        <Stat label="Due today" value={summary.dueTodayCount} />
        <Stat label="Due tomorrow" value={summary.dueTomorrowCount} />
      </div>

      <div className="mt-4 border-t border-border-soft pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-soft">Work remaining today</span>
          <span className="font-mono font-medium">
            {formatMinutes(summary.totalRemainingMinutesToday)}
            {summary.itemsMissingEstimateToday > 0 && (
              <span className="ml-1 text-xs text-ink-faint">
                (+{summary.itemsMissingEstimateToday} unestimated)
              </span>
            )}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="text-ink-soft">Free time logged today</span>
          <span className="font-mono font-medium">
            {summary.availableMinutesToday == null ? (
              <span className="text-ink-faint">not tracked yet</span>
            ) : (
              formatMinutes(summary.availableMinutesToday)
            )}
          </span>
        </div>
        {summary.aheadBehindMinutes != null && (
          <div className="mt-1.5 flex justify-between">
            <span className="text-ink-soft">Ahead / behind</span>
            <span
              className={`font-mono font-medium ${summary.aheadBehindMinutes < 0 ? "text-danger" : "text-ok"}`}
            >
              {summary.aheadBehindMinutes >= 0 ? "+" : ""}
              {formatMinutes(Math.abs(summary.aheadBehindMinutes))}
              {summary.aheadBehindMinutes < 0 ? " behind" : " ahead"}
            </span>
          </div>
        )}
      </div>

      {summary.upcomingDeadlines.length > 0 && (
        <div className="mt-4 border-t border-border-soft pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Upcoming deadlines
          </h4>
          <ul className="mt-2 flex flex-col gap-1.5">
            {summary.upcomingDeadlines.map((d) => (
              <li key={d.id} className="flex justify-between text-sm">
                <span className="truncate pr-2">{d.title}</span>
                <span className="flex-none text-xs text-ink-faint">
                  {formatDueLabel(d.dueAt, now, tz)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg bg-surface-2 py-2.5">
      <div className={`font-mono text-xl font-semibold ${tone === "danger" && value > 0 ? "text-danger" : "text-ink"}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

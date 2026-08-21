import { resolvePendingChangeAction } from "@/app/email/actions";

export interface PendingChangeRow {
  id: string;
  entityType: string;
  entityId: string | null;
  field: string;
  oldValueText: string | null;
  newValueText: string | null;
  reason: string | null;
  className: string | null;
  sourceSubject: string | null;
  sourceGmailId: string | null;
}

function formatValue(field: string, value: string | null): string {
  if (!value) return "(nothing on file)";
  if (field === "examAt" || field === "dueAt") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
  }
  return value;
}

const FIELD_LABEL: Record<string, string> = {
  examAt: "exam date/time",
  dueAt: "due date",
  location: "location",
  weight: "grade weight",
  name: "name",
  description: "description",
  pointsPossible: "points possible",
  professor: "professor",
  room: "room",
  currentGrade: "current grade",
};

export function PendingChangesQueue({ changes }: { changes: PendingChangeRow[] }) {
  if (changes.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl2 border border-warn bg-warn-soft/40 p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">
        Needs your decision <span className="text-sm font-normal text-ink-soft">({changes.length})</span>
      </h3>
      <p className="mt-0.5 text-xs text-ink-soft">
        Email never overwrites your schedule automatically — these conflict with what's already on file.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {changes.map((c) => {
          const emailLink = c.sourceGmailId ? (
            <a href={`https://mail.google.com/mail/u/0/#all/${c.sourceGmailId}`} target="_blank" rel="noreferrer" className="underline">
              an email
            </a>
          ) : (
            "an email"
          );
          const isNewRecord = c.entityId === null;
          return (
            <li key={c.id} className="rounded-xl2 border border-border-soft bg-surface p-4">
              {isNewRecord ? (
                <p className="text-sm">
                  {c.className && <span className="font-medium">{c.className}: </span>}
                  {c.reason} {emailLink} proposed: <span className="font-medium">{formatValue(c.field, c.newValueText)}</span>.
                </p>
              ) : (
                <p className="text-sm">
                  {c.className && <span className="font-medium">{c.className}: </span>}
                  Your {FIELD_LABEL[c.field] ?? c.field} says{" "}
                  <span className="font-medium">{formatValue(c.field, c.oldValueText)}</span>, but {emailLink} says{" "}
                  <span className="font-medium">{formatValue(c.field, c.newValueText)}</span>. Which should I use?
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <form action={resolvePendingChangeAction.bind(null, c.id, "accept")}>
                  <button className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-surface hover:opacity-90">
                    {isNewRecord ? "Add it" : "Use the email's version"}
                  </button>
                </form>
                <form action={resolvePendingChangeAction.bind(null, c.id, "reject")}>
                  <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
                    {isNewRecord ? "Ignore" : "Keep what I have"}
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

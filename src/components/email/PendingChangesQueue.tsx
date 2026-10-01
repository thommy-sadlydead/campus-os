import { resolvePendingChangeAction } from "@/app/email/actions";
import { AlertIcon } from "@/components/icons";

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
    <section className="card mb-8 overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border-soft bg-warn-soft px-4 py-4 sm:px-5">
        <AlertIcon className="mt-0.5 h-5 w-5 flex-none text-warn" />
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            Needs your decision
            <span className="badge bg-surface tabular-nums text-warn">{changes.length}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Email never overwrites your schedule automatically — these conflict with what's already on file.
          </p>
        </div>
      </header>
      <ul className="divide-y divide-border-soft">
        {changes.map((c) => {
          const emailLink = c.sourceGmailId ? (
            <a
              href={`https://mail.google.com/mail/u/0/#all/${c.sourceGmailId}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent-ink underline underline-offset-2"
            >
              an email
            </a>
          ) : (
            "an email"
          );
          const isNewRecord = c.entityId === null;
          return (
            <li key={c.id} className="px-4 py-4 sm:px-5">
              {isNewRecord ? (
                <p className="text-sm leading-relaxed text-ink-soft">
                  {c.className && <span className="font-semibold text-ink">{c.className}: </span>}
                  {c.reason} {emailLink} proposed: <span className="font-semibold text-ink">{formatValue(c.field, c.newValueText)}</span>.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-ink-soft">
                  {c.className && <span className="font-semibold text-ink">{c.className}: </span>}
                  Your {FIELD_LABEL[c.field] ?? c.field} says{" "}
                  <span className="font-semibold text-ink">{formatValue(c.field, c.oldValueText)}</span>, but {emailLink} says{" "}
                  <span className="font-semibold text-ink">{formatValue(c.field, c.newValueText)}</span>. Which should I use?
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <form action={resolvePendingChangeAction.bind(null, c.id, "accept")}>
                  <button className="btn btn-primary btn-sm">
                    {isNewRecord ? "Add it" : "Use the email's version"}
                  </button>
                </form>
                <form action={resolvePendingChangeAction.bind(null, c.id, "reject")}>
                  <button className="btn btn-secondary btn-sm">
                    {isNewRecord ? "Ignore" : "Keep what I have"}
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

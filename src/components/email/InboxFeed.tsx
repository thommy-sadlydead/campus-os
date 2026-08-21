export interface InboxEmailRow {
  id: string;
  subject: string;
  snippet: string | null;
  fromName: string | null;
  fromAddress: string;
  receivedAt: string; // ISO
  category: string;
  className: string | null;
  gmailMessageId: string;
}

const CATEGORY_BADGE: Record<string, { emoji: string; label: string; tone: string }> = {
  EXAM: { emoji: "🔴", label: "Exam", tone: "bg-danger-soft text-danger" },
  SCHEDULE_CHANGE: { emoji: "🟠", label: "Schedule change", tone: "bg-warn-soft text-warn" },
  ASSIGNMENT: { emoji: "🟡", label: "Assignment", tone: "bg-warn-soft text-warn" },
  SYLLABUS: { emoji: "🟢", label: "Syllabus", tone: "bg-ok-soft text-ok" },
  ANNOUNCEMENT: { emoji: "🔵", label: "Announcement", tone: "bg-surface-2 text-ink-soft" },
  OTHER_ACADEMIC: { emoji: "⚪", label: "Academic", tone: "bg-surface-2 text-ink-soft" },
};

export function InboxFeed({ emails }: { emails: InboxEmailRow[] }) {
  if (emails.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        No academically relevant emails found yet. Hit "Sync now" above, or check back after your professors send
        something.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {emails.map((e) => {
        const badge = CATEGORY_BADGE[e.category] ?? CATEGORY_BADGE.OTHER_ACADEMIC;
        return (
          <li key={e.id}>
            <a
              href={`https://mail.google.com/mail/u/0/#all/${e.gmailMessageId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card transition-colors hover:border-accent"
            >
              <span className="flex-none rounded-full px-2 py-1 text-xs font-semibold" title={badge.label}>
                {badge.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{e.subject}</span>
                  {e.className && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-soft">{e.className}</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.label}</span>
                </div>
                {e.snippet && <p className="mt-1 truncate text-sm text-ink-soft">{e.snippet}</p>}
                <div className="mt-1 text-xs text-ink-faint">
                  {e.fromName || e.fromAddress} · {new Date(e.receivedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

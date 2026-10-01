import { decodeHtmlEntities } from "@/lib/text";

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

const CATEGORY_BADGE: Record<string, { label: string; tone: string; dot: string }> = {
  EXAM: { label: "Exam", tone: "bg-danger-soft text-danger", dot: "bg-danger" },
  SCHEDULE_CHANGE: { label: "Schedule change", tone: "bg-warn-soft text-warn", dot: "bg-accent" },
  ASSIGNMENT: { label: "Assignment", tone: "bg-warn-soft text-warn", dot: "bg-warn" },
  SYLLABUS: { label: "Syllabus", tone: "bg-ok-soft text-ok", dot: "bg-ok" },
  ANNOUNCEMENT: { label: "Announcement", tone: "bg-surface-2 text-ink-soft", dot: "bg-course-6" },
  OTHER_ACADEMIC: { label: "Academic", tone: "bg-surface-2 text-ink-soft", dot: "bg-ink-faint" },
};

export function InboxFeed({ emails }: { emails: InboxEmailRow[] }) {
  if (emails.length === 0) {
    return (
      <div className="empty">
        No academically relevant emails found yet. Hit "Sync now" above, or check back after your professors send
        something.
      </div>
    );
  }

  return (
    <ul className="card divide-y divide-border-soft overflow-hidden">
      {emails.map((e) => {
        const badge = CATEGORY_BADGE[e.category] ?? CATEGORY_BADGE.OTHER_ACADEMIC;
        return (
          <li key={e.id}>
            <a
              href={`https://mail.google.com/mail/u/0/#all/${e.gmailMessageId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5"
            >
              <span aria-hidden className={`dot mt-[7px] ${badge.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-ink">{e.subject}</span>
                  <span className="flex-none text-xs text-ink-faint">
                    {new Date(e.receivedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                {e.snippet && <p className="mt-0.5 truncate text-[13px] text-ink-soft">{decodeHtmlEntities(e.snippet)}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  {e.className && <span className="badge bg-surface-2 text-ink-soft">{e.className}</span>}
                  <span className="ml-0.5 truncate">{e.fromName || e.fromAddress}</span>
                </div>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

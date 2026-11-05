"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findHelpInSyllabusAction } from "@/app/classes/[id]/ai-actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { HELP_REASONS, professorEmailDraft, type HelpReason } from "@/lib/get-help";
import { gmailLink, mailtoLink, outlookLink } from "@/lib/compose-links";
import { ExternalIcon, MailIcon, SparkIcon } from "@/components/icons";

export interface HelpInfo {
  professorEmail: string | null;
  officeHours: string | null;
  studentName: string | null;
  /** Searches of the student's school site (campusHelpLinks), empty without a school email. */
  campusLinks: { label: string; url: string }[];
  nextExamName: string | null;
  hasSyllabus: boolean;
  aiAllowed: boolean;
}

/**
 * Getting help (src/lib/get-help.ts) on a class's Overview: office hours,
 * a prewritten email to the professor in the student's own mail app, and
 * where to find help at their school.
 */
export function GetHelpCard({
  classId,
  className,
  classCode,
  professor,
  help,
  initialReason = "question",
}: {
  classId: string;
  className: string;
  classCode: string | null;
  professor: string | null;
  help: HelpInfo;
  initialReason?: HelpReason;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<HelpReason>(initialReason);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const draft = professorEmailDraft({
    reason,
    className,
    classCode,
    professor,
    studentName: help.studentName,
    officeHours: help.officeHours,
    examName: help.nextExamName,
  });
  const compose = { to: help.professorEmail ?? "", cc: null, ...draft };

  function findInSyllabus() {
    setMessage(null);
    startTransition(async () => {
      const result = await findHelpInSyllabusAction(classId);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      const found = [result.found?.professorEmail && "an email", result.found?.officeHours && "office hours"].filter(Boolean);
      setMessage(found.length ? `Found ${found.join(" and ")} in the syllabus.` : "The syllabus doesn't list an email or office hours.");
      router.refresh();
    });
  }

  return (
    <div className="card p-5">
      <CardHeader title="Getting help" description="Office hours are for exactly this: questions, a grade you want to bring up, or getting ready for an exam." />

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-faint">Office hours</dt>
          <dd className="mt-1 font-medium text-ink">{help.officeHours || <span className="font-normal text-ink-faint">Not set</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Professor&apos;s email</dt>
          <dd className="mt-1 break-all font-medium text-ink">{help.professorEmail || <span className="font-normal text-ink-faint">Not set</span>}</dd>
        </div>
      </dl>
      {(!help.officeHours || !help.professorEmail) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          {help.hasSyllabus && help.aiAllowed ? (
            <button type="button" onClick={findInSyllabus} disabled={pending} className="btn btn-secondary btn-sm">
              <SparkIcon className="h-3.5 w-3.5" />
              {pending ? "Reading the syllabus…" : "Find in syllabus"}
            </button>
          ) : null}
          <span>Or add them under Details.</span>
        </div>
      )}
      {message && <p className="mt-2 text-[13px] text-ink-soft">{message}</p>}

      <div className="mt-4 border-t border-border-soft pt-4">
        <label className="flex flex-col">
          <span className="field-label">Email your professor about</span>
          <select value={reason} onChange={(e) => setReason(e.target.value as HelpReason)} className="field field-sm">
            {HELP_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-[13px] leading-relaxed text-ink-soft">
          {`Subject: ${draft.subject}\n\n${draft.body}`}
        </pre>
        <p className="mt-2 text-xs text-ink-faint">Fill in the parts in [brackets] before you send it.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={mailtoLink(compose)} className="btn btn-primary btn-sm">
            <MailIcon className="h-3.5 w-3.5" />
            Open in Mail
          </a>
          <a href={gmailLink(compose)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Gmail
          </a>
          <a href={outlookLink(compose)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Outlook
          </a>
        </div>
      </div>

      <div className="mt-4 border-t border-border-soft pt-4">
        <p className="text-sm font-semibold text-ink">More help at your school</p>
        {help.campusLinks.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {help.campusLinks.map((l) => (
              <li key={l.label}>
                <a href={l.url} target="_blank" rel="noreferrer" className="badge bg-surface-2 text-ink-soft hover:text-ink">
                  {l.label}
                  <ExternalIcon className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-ink-soft">Your school&apos;s website lists tutoring, a writing center and counseling.</p>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          Having a hard time? In the US, call or text <a href="tel:988" className="font-medium text-ink underline decoration-border underline-offset-2">988</a> any time to talk to someone.
        </p>
      </div>
    </div>
  );
}

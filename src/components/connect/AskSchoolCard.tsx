"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { recordSchoolRequestAction } from "@/app/connect/school-request-actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { CheckIcon, CopyIcon, ExternalIcon, MailIcon } from "@/components/icons";
import { copyToClipboard } from "@/lib/clipboard";
import { emailAsText, gmailLink, isEmailAddress, mailtoLink, outlookLink } from "@/lib/lms/school-request";
import type { FeedProvider } from "@/lib/lms/providers";

/**
 * Connect → Brightspace/Blackboard: ask the school to turn on Campus OS in
 * that LMS. The email is written here and sent from the student's own mail
 * app (or Gmail/Outlook on the web); opening it counts the request.
 */
export function AskSchoolCard({
  provider,
  providerName,
  host,
  subject,
  body,
  cc,
  savedContact,
  suggestedContact,
  askedLabel,
  othersAsked,
}: {
  provider: FeedProvider;
  providerName: string;
  host: string;
  subject: string;
  body: string;
  /** The developer's address (CONTACT_EMAIL), so the school can reply to someone. */
  cc: string | null;
  /** Where this student sent it before. */
  savedContact: string | null;
  /** Where other students at the school sent it, when it's at the school's own domain. */
  suggestedContact: string | null;
  /** "today at 3:10 PM": when this student last asked. */
  askedLabel: string | null;
  othersAsked: number;
}) {
  const [to, setTo] = useState(savedContact ?? suggestedContact ?? "");
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const valid = isEmailAddress(to);
  const email = { to: to.trim(), cc, subject, body };

  function record(e: MouseEvent) {
    if (!valid) {
      e.preventDefault();
      return;
    }
    startTransition(() => recordSchoolRequestAction(provider, to));
  }

  async function copy(e: MouseEvent) {
    record(e);
    if (valid && (await copyToClipboard({ text: emailAsText(email) }))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const linkState = valid ? "" : "pointer-events-none opacity-50";

  return (
    <section id="ask-school" className="card card-pad scroll-mt-20">
      <CardHeader
        icon={<MailIcon className="h-[18px] w-[18px]" />}
        title="Get directions, turned-in work and course files"
        description={`${providerName} only shares these with apps your school has turned on. Ask your school to turn on Campus OS: the email is written for you, and you send it from your own email.`}
      />

      {askedLabel && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-ink-soft">
          <CheckIcon className="h-4 w-4 flex-none text-ok" />
          You asked {askedLabel}. Thanks! Schools usually take a few weeks to decide.
        </p>
      )}

      <label className="mt-4 block">
        <span className="field-label">Send to</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="helpdesk@yourschool.edu"
          className="field"
        />
        <span className="mt-1.5 block text-xs leading-relaxed text-ink-faint">
          {suggestedContact && to.trim().toLowerCase() === suggestedContact
            ? "Other students at your school sent it here. Make sure it's your school's IT help desk."
            : `Usually your school's IT help desk, or the team that runs ${providerName} (often called eLearning, Academic Technology or Teaching and Learning). Their address is often on your school's ${providerName} sign-in or help page.`}
        </span>
      </label>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">See the email</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-sans leading-relaxed text-ink-soft">
          {emailAsText({ ...email, to: email.to || "(your school's address)" })}
        </pre>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={mailtoLink(email)} onClick={record} aria-disabled={!valid} className={`btn btn-primary btn-sm ${linkState}`}>
          <MailIcon className="h-4 w-4" />
          Open in my email app
        </a>
        <a href={gmailLink(email)} onClick={record} target="_blank" rel="noopener noreferrer" aria-disabled={!valid} className={`btn btn-secondary btn-sm ${linkState}`}>
          Gmail
          <ExternalIcon className="h-3.5 w-3.5 text-ink-faint" />
        </a>
        <a href={outlookLink(email)} onClick={record} target="_blank" rel="noopener noreferrer" aria-disabled={!valid} className={`btn btn-secondary btn-sm ${linkState}`}>
          Outlook
          <ExternalIcon className="h-3.5 w-3.5 text-ink-faint" />
        </a>
        <button type="button" onClick={copy} disabled={!valid} className="btn btn-ghost btn-sm">
          {copied ? <CheckIcon className="h-4 w-4 text-ok" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy email"}
        </button>
      </div>

      {othersAsked > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {othersAsked === 1 ? "1 other student" : `${othersAsked} other students`} at {host} asked too. The more who ask, the more
          likely your school says yes.
        </p>
      )}
    </section>
  );
}

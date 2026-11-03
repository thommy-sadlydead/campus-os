"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { newCalendarLinkAction } from "@/app/schedule/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { CalendarIcon, CheckIcon, CopyIcon, ExternalIcon } from "@/components/icons";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Schedule → Add to your calendar: the student's class meetings as a
 * calendar subscription (a secret link; see calendar-feed-server.ts), which
 * their calendar app keeps up to date as meetings change here.
 */
export function CalendarSyncCard({ links }: { links: { https: string; webcal: string; google: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  function makeLink() {
    startTransition(async () => {
      await newCalendarLinkAction();
      setConfirmReset(false);
      router.refresh();
    });
  }

  async function copy() {
    if (!links) return;
    if (await copyToClipboard({ text: links.https })) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section className="card card-pad h-fit">
      <CardHeader
        icon={<CalendarIcon className="h-[18px] w-[18px]" />}
        title="Add to your calendar"
        description="Your class meetings in Apple, Google or Outlook Calendar, repeating every week. Changes you make here show up there on their own."
      />
      {!links ? (
        <button type="button" onClick={makeLink} disabled={pending} className="btn btn-secondary mt-4 w-full">
          {pending ? "Making your link…" : "Set up calendar link"}
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <a href={links.webcal} className="btn btn-secondary w-full">
            Apple Calendar
          </a>
          <a href={links.google} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">
            Google Calendar
            <ExternalIcon className="h-3.5 w-3.5 text-ink-faint" />
          </a>
          <button type="button" onClick={copy} className="btn btn-ghost w-full">
            {copied ? <CheckIcon className="h-4 w-4 text-ok" /> : <CopyIcon className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link for Outlook or others"}
          </button>
          <p className="text-xs leading-relaxed text-ink-faint">
            Anyone with this link can see your class times, so keep it to yourself. Calendar apps check for changes every few
            hours.
          </p>
          {confirmReset ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
              The old link stops working, so calendars using it stop updating.
              <button type="button" onClick={makeLink} disabled={pending} className="btn btn-destructive btn-sm">
                Make a new link
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className="btn btn-ghost btn-sm">
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="self-start text-xs font-medium text-ink-faint underline-offset-2 hover:text-ink hover:underline"
            >
              Shared it by mistake? Make a new link
            </button>
          )}
        </div>
      )}
    </section>
  );
}

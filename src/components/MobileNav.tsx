"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import {
  BookIcon,
  CalendarIcon,
  ChecklistIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  LogOutIcon,
  MailIcon,
  MicIcon,
  MoreIcon,
  UserIcon,
} from "@/components/icons";

// Phones and tablets (below lg) get a floating tab bar, the way iPhone apps
// are laid out, instead of the sidebar. Record sits raised in the middle
// because it's the one thing you need in a hurry, in class. Everything else
// lives under More.

const TABS = [
  { href: "/dashboard", label: "Today", Icon: HomeIcon },
  { href: "/classes", label: "Classes", Icon: BookIcon },
  { href: "/schedule", label: "Schedule", Icon: CalendarIcon },
];

export function MobileNav({
  active,
  lms,
  email,
  record,
}: {
  active: string;
  lms: { href: string; label: string };
  /** Whether this account has Email on and can use it (src/lib/gmail-access.ts). */
  email: boolean;
  /** Whether lecture recording is on (src/lib/features.ts). Without it, Assignments takes Record's place. */
  record: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  // `match` is the `active` value each link's pages pass: every LMS page
  // passes "/connect".
  const moreLinks = [
    ...(record ? [{ href: "/assignments", label: "Assignments", Icon: ChecklistIcon, match: "/assignments" }] : []),
    ...(email ? [{ href: "/email", label: "Email", Icon: MailIcon, match: "/email" }] : []),
    { href: lms.href, label: lms.label, Icon: LayersIcon, match: "/connect" },
    { href: "/account", label: "Account", Icon: UserIcon, match: "/account" },
  ];
  const moreActive = moreLinks.some((link) => link.match === active);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  // A floating black pill (white in dark mode): the active tab is a filled
  // pill with its icon and label, the others are icons only. Record sits
  // raised above the middle as a 64px circle.
  const tabClass = (isActive: boolean) =>
    `flex h-11 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-[background-color,color,padding] duration-200 ${
      isActive ? "bg-ink px-4 text-surface" : "w-11 text-ink-soft hover:text-ink"
    }`;
  const iconClass = "h-[21px] w-[21px] flex-none";
  const label = (isActive: boolean, text: string) => (isActive ? <span>{text}</span> : <span className="sr-only">{text}</span>);

  const [today, classes, schedule] = TABS;
  const third = record
    ? null
    : { href: "/assignments", label: "Assignments", Icon: ChecklistIcon };

  return (
    <>
      <nav
        aria-label="Main"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="pointer-events-auto relative mx-auto max-w-md">
          {record && (
            <Link prefetch={false}
              href="/record"
              aria-label="Record a lecture"
              aria-current={active === "/record" ? "page" : undefined}
              className="absolute -top-9 left-1/2 z-10 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-ink text-surface ring-[5px] ring-bg transition-transform active:scale-95"
            >
              <MicIcon className="h-[26px] w-[26px]" />
            </Link>
          )}
          <ul className="theme-inverse flex items-center justify-between rounded-full p-1.5 shadow-pop">
            {[today, classes].map(({ href, label: text, Icon }) => (
              <li key={href}>
                <Link prefetch={false} href={href} className={tabClass(active === href)} aria-current={active === href ? "page" : undefined}>
                  <Icon className={iconClass} />
                  {label(active === href, text)}
                </Link>
              </li>
            ))}
            {record ? (
              <li aria-hidden className="w-16 flex-none" />
            ) : (
              third && (
                <li>
                  <Link prefetch={false} href={third.href} className={tabClass(active === third.href)} aria-current={active === third.href ? "page" : undefined}>
                    <third.Icon className={iconClass} />
                    {label(active === third.href, third.label)}
                  </Link>
                </li>
              )
            )}
            <li>
              <Link prefetch={false}
                href={schedule.href}
                className={tabClass(active === schedule.href)}
                aria-current={active === schedule.href ? "page" : undefined}
              >
                <schedule.Icon className={iconClass} />
                {label(active === schedule.href, schedule.label)}
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                className={tabClass(moreActive)}
              >
                <MoreIcon className={iconClass} />
                {label(moreActive, "More")}
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-border-soft bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-pop">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
            <ul className="mx-auto flex max-w-lg flex-col gap-0.5">
              {moreLinks.map(({ href, label, Icon, match }) => (
                <li key={href}>
                  <Link prefetch={false}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active === match ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium ${
                      active === match ? "bg-surface-2 text-ink" : "text-ink hover:bg-surface-2"
                    }`}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="flex-1">{label}</span>
                    <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
                  </Link>
                </li>
              ))}
              <li className="mt-2 border-t border-border-soft pt-2">
                <form action={logoutAction}>
                  <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium text-danger hover:bg-danger-soft">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger-soft">
                      <LogOutIcon className="h-[18px] w-[18px]" />
                    </span>
                    Log out
                  </button>
                </form>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";

// Phones and tablets (below lg) get a bottom tab bar, the way iPhone apps
// are laid out, instead of a top menu that runs off the side of the
// screen. Record sits in the middle because it's the one thing you need
// in a hurry, in class. Everything else lives under More.

const ICON_PROPS = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function TodayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function ClassesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

const TABS = [
  { href: "/dashboard", label: "Today", Icon: TodayIcon },
  { href: "/classes", label: "Classes", Icon: ClassesIcon },
  { href: "/schedule", label: "Schedule", Icon: ScheduleIcon },
];

const MORE_LINKS = [
  { href: "/assignments", label: "Assignments" },
  { href: "/email", label: "Email" },
  { href: "/canvas", label: "Canvas" },
  { href: "/voicewrite", label: "Voicewrite" },
  { href: "/account", label: "Account" },
];

export function MobileNav({ active }: { active: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_LINKS.some((link) => link.href === active);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const tabClass = (isActive: boolean) =>
    `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-ink" : "text-ink-faint"}`;

  const [today, classes, schedule] = TABS;

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-end">
          {[today, classes].map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className={tabClass(active === href)} aria-current={active === href ? "page" : undefined}>
                <Icon />
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/record"
              aria-label="Record a lecture"
              aria-current={active === "/record" ? "page" : undefined}
              className="flex flex-col items-center gap-0.5 pb-2 text-[11px] font-medium text-ink"
            >
              <span className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger shadow-card ring-4 ring-surface">
                <span className="block h-4 w-4 rounded-full bg-white" />
              </span>
              Record
            </Link>
          </li>
          <li>
            <Link
              href={schedule.href}
              className={tabClass(active === schedule.href)}
              aria-current={active === schedule.href ? "page" : undefined}
            >
              <schedule.Icon />
              {schedule.label}
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={`w-full ${tabClass(moreActive)}`}
            >
              <MoreIcon />
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border-soft bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-card">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
            <ul className="mx-auto flex max-w-lg flex-col">
              {MORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active === link.href ? "page" : undefined}
                    className={`block rounded-lg px-3 py-3 text-base ${
                      active === link.href ? "bg-surface-2 font-semibold" : "hover:bg-surface-2"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t border-border-soft pt-1">
                <form action={logoutAction}>
                  <button className="block w-full rounded-lg px-3 py-3 text-left text-base text-danger hover:bg-surface-2">
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

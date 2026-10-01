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

const MORE_LINKS = [
  { href: "/assignments", label: "Assignments", Icon: ChecklistIcon },
  { href: "/email", label: "Email", Icon: MailIcon },
  { href: "/canvas", label: "Canvas", Icon: LayersIcon },
  { href: "/account", label: "Account", Icon: UserIcon },
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
    `flex w-full flex-col items-center gap-1 rounded-2xl py-1.5 text-[10.5px] font-medium transition-colors ${
      isActive ? "text-ink" : "text-ink-faint"
    }`;
  const iconClass = (isActive: boolean) => `h-[22px] w-[22px] ${isActive ? "text-accent" : ""}`;

  const [today, classes, schedule] = TABS;

  return (
    <>
      <nav
        aria-label="Main"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))] lg:hidden"
      >
        <ul className="glass pointer-events-auto mx-auto grid max-w-md grid-cols-5 items-end rounded-[24px] border border-border-soft px-1.5 pb-1 pt-1.5 shadow-pop">
          {[today, classes].map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className={tabClass(active === href)} aria-current={active === href ? "page" : undefined}>
                <Icon className={iconClass(active === href)} />
                {label}
              </Link>
            </li>
          ))}
          <li className="flex justify-center">
            <Link
              href="/record"
              aria-label="Record a lecture"
              aria-current={active === "/record" ? "page" : undefined}
              className="flex flex-col items-center gap-1 pb-1.5 text-[10.5px] font-medium text-ink"
            >
              <span
                className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full text-white ring-[5px] ring-bg"
                style={{
                  backgroundImage: "linear-gradient(135deg, var(--grad-from), var(--grad-to))",
                  boxShadow: "0 10px 24px -8px rgba(255, 122, 47, 0.6)",
                }}
              >
                <MicIcon className="h-6 w-6" />
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
              <schedule.Icon className={iconClass(active === schedule.href)} />
              {schedule.label}
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
              <MoreIcon className={iconClass(moreActive)} />
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
            className="absolute inset-0 h-full w-full bg-black/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-border-soft bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-pop">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
            <ul className="mx-auto flex max-w-lg flex-col gap-0.5">
              {MORE_LINKS.map(({ href, label, Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active === href ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium ${
                      active === href ? "bg-surface-2 text-ink" : "text-ink hover:bg-surface-2"
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

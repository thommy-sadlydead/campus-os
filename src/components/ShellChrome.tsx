"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { MobileNav } from "@/components/MobileNav";
import { Logo, LogoMark } from "@/components/Logo";
import { BookIcon, CalendarIcon, ChecklistIcon, HomeIcon, LayersIcon, LogOutIcon, MailIcon, MicIcon, UserIcon } from "@/components/icons";

// The app's frame around every signed-in page: wide screens (lg and up) get
// a sidebar; phones and tablets get a slim top bar and MobileNav's floating
// tab bar instead, the way iPhone apps are laid out. AppShell fills it in on
// the server; ShellSkeleton draws the same frame while a page loads (each
// main page's loading.tsx), so tapping a tab answers at once instead of
// waiting on the database.
//
// The links prefetch again (Nov 9, 2026). Before the pages had loading
// screens, a prefetch rendered the whole page on the server, about six per
// page view, which helped run the database out of connections on Nov 5. Now
// a prefetch stops at the loading screen and never touches the database.

export interface ShellNav {
  userName: string;
  lms: { href: string; label: string };
  /** Email is on and this account can use it (src/lib/gmail-access.ts). */
  email: boolean;
  /** Lecture recording is on (src/lib/features.ts). */
  record: boolean;
}

const WORKSPACE = [
  { href: "/dashboard", label: "Today", Icon: HomeIcon },
  { href: "/classes", label: "Classes", Icon: BookIcon },
  { href: "/assignments", label: "Assignments", Icon: ChecklistIcon },
  { href: "/schedule", label: "Schedule", Icon: CalendarIcon },
];

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

// The last frame a real page drew, so the loading screen between two pages
// shows the same tabs and name instead of a generic set.
let lastNav: ShellNav | null = null;
const DEFAULT_NAV: ShellNav = { userName: "", lms: { href: "/connect", label: "Connect classes" }, email: false, record: true };

function NavLink({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-ink text-surface" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${active ? "" : "text-ink-faint group-hover:text-ink-soft"}`} />
      {label}
    </Link>
  );
}

export function ShellChrome({ active, nav, children }: { active: string; nav: ShellNav; children: React.ReactNode }) {
  useEffect(() => {
    lastNav = nav;
  }, [nav]);

  const connections = [
    ...(nav.email ? [{ href: "/email", label: "Email", Icon: MailIcon, match: "/email" }] : []),
    { href: nav.lms.href, label: nav.lms.label, Icon: LayersIcon, match: "/connect" },
  ];

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Padded by the safe-area insets so the iPad app keeps the logo clear of
          the status bar and the account row clear of the home indicator. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border-soft bg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] lg:flex">
        <div className="flex h-16 flex-none items-center px-5">
          <Link href="/dashboard" aria-label="Campus OS home">
            <Logo />
          </Link>
        </div>
        {nav.record && (
          <div className="px-3 pt-1">
            <Link href="/record" aria-current={active === "/record" ? "page" : undefined} className="btn btn-brand w-full">
              <MicIcon className="h-[18px] w-[18px]" />
              Record a lecture
            </Link>
          </div>
        )}
        <nav aria-label="Main" className="mt-6 flex flex-1 flex-col gap-6 overflow-y-auto px-3">
          <div>
            <p className="eyebrow mb-2 px-3">Workspace</p>
            <div className="flex flex-col gap-0.5">
              {WORKSPACE.map((item) => (
                <NavLink key={item.href} {...item} active={active === item.href} />
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-2 px-3">Connections</p>
            <div className="flex flex-col gap-0.5">
              {connections.map(({ match, ...item }) => (
                <NavLink key={item.href} {...item} active={active === match} />
              ))}
            </div>
          </div>
        </nav>
        <div className="flex-none border-t border-border-soft p-3">
          <div className="flex items-center gap-1">
            <Link
              href="/account"
              aria-current={active === "/account" ? "page" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                active === "/account" ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-soft ring-1 ring-border">
                {initials(nav.userName) || <UserIcon className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{nav.userName}</span>
                <span className="block text-xs text-ink-faint">Account</span>
              </span>
            </Link>
            <form action={logoutAction}>
              <button title="Log out" aria-label="Log out" className="btn btn-ghost h-9 min-h-0 w-9 px-0">
                <LogOutIcon className="h-[18px] w-[18px]" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Padded by the safe-area inset so the installed iPhone app keeps the
          bar clear of the status bar and notch. */}
      <header className="glass sticky top-0 z-30 pt-[env(safe-area-inset-top)] lg:hidden">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/dashboard" aria-label="Campus OS home" className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Campus OS</span>
          </Link>
          <Link
            href="/account"
            aria-label="Account"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-soft bg-surface text-xs font-semibold text-ink"
          >
            {initials(nav.userName) || <UserIcon className="h-4 w-4" />}
          </Link>
        </div>
      </header>

      <div className="relative z-10 lg:pl-64">
        {/* Bottom padding keeps the last thing on a page above the tab bar. */}
        <main className="mx-auto max-w-6xl px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>
      </div>
      <MobileNav active={active} lms={nav.lms} email={nav.email} record={nav.record} />
    </div>
  );
}

/** The frame with placeholder blocks, for a page's loading.tsx. */
export function ShellSkeleton({ active }: { active: string }) {
  return (
    <ShellChrome active={active} nav={lastNav ?? DEFAULT_NAV}>
      <div role="status" className="animate-pulse">
        <span className="sr-only">Loading…</span>
        <div className="h-3.5 w-28 rounded-full bg-surface-2" />
        <div className="mt-3 h-8 w-56 max-w-full rounded-full bg-surface-2" />
        <div className="mt-8 flex flex-col gap-3">
          <div className="card h-24" />
          <div className="card h-40" />
          <div className="card h-24" />
        </div>
      </div>
    </ShellChrome>
  );
}

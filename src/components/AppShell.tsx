import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { MobileNav } from "@/components/MobileNav";

// The top menu is for wide screens (lg and up). Below that, MobileNav's
// bottom tab bar takes over, so nothing runs off the side of a phone.
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/assignments", label: "Assignments" },
  { href: "/classes", label: "Classes" },
  { href: "/canvas", label: "Canvas" },
  { href: "/email", label: "Email" },
  { href: "/voicewrite", label: "Voicewrite" },
];

export function AppShell({
  active,
  userName,
  children,
}: {
  active: string;
  userName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Padded by the safe-area inset so an installed iPhone app keeps the
          header clear of the status bar and notch. */}
      <header className="border-b border-border-soft bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-8">
            <Link href="/dashboard" className="flex-none font-display text-lg font-semibold tracking-tight">
              Campus OS
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active === item.href ? "page" : undefined}
                  className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active === item.href ? "bg-ink text-surface" : "text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="hidden flex-none items-center gap-2 lg:flex">
            <Link
              href="/record"
              className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <span aria-hidden className="block h-2 w-2 rounded-full bg-white" />
              Record
            </Link>
            <Link
              href="/account"
              title={userName}
              aria-current={active === "/account" ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active === "/account" ? "bg-ink text-surface" : "text-ink-soft hover:bg-surface-2"
              }`}
            >
              Account
            </Link>
            <form action={logoutAction}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* Bottom padding keeps the last thing on a page above the tab bar. */}
      <main className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:pb-8 lg:pt-8">
        {children}
      </main>
      <MobileNav active={active} />
    </div>
  );
}

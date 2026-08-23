import Link from "next/link";
import { logoutAction } from "@/app/login/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/assignments", label: "Assignments" },
  { href: "/classes", label: "Classes" },
  { href: "/canvas", label: "Canvas" },
  { href: "/email", label: "Email" },
  { href: "/notes", label: "Notes" },
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
      <header className="border-b border-border-soft bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <span className="flex-none font-display text-lg font-semibold tracking-tight">
              Campus OS
            </span>
            <nav className="flex items-center gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active === item.href
                      ? "bg-ink text-surface"
                      : "text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex flex-none items-center gap-3">
            <span className="hidden text-sm text-ink-soft sm:inline">{userName}</span>
            <form action={logoutAction}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

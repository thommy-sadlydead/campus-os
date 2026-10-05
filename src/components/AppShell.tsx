import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { MobileNav } from "@/components/MobileNav";
import { NativeAppBridge } from "@/components/NativeAppBridge";
import { Logo, LogoMark } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import { getAccess, paymentsEnabled } from "@/lib/billing-server";
import { lmsNavItem } from "@/lib/lms/connections";
import {
  AlertIcon,
  BookIcon,
  CalendarIcon,
  ChecklistIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  LogOutIcon,
  MailIcon,
  MicIcon,
  SparkIcon,
  UserIcon,
} from "@/components/icons";

// Wide screens (lg and up) get a sidebar; phones and tablets get a slim top
// bar and MobileNav's floating tab bar instead, the way iPhone apps are
// laid out.

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
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface-2 text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${active ? "text-accent" : "text-ink-faint group-hover:text-ink-soft"}`} />
      {label}
    </Link>
  );
}

/** During the free trial, or when a renewal payment failed. */
async function BillingBanner() {
  const user = paymentsEnabled() ? await getCurrentUser() : null;
  const access = user ? await getAccess(user.id) : null;
  if (access?.kind === "trial") {
    return (
      <Link
        href="/subscribe"
        className="mb-5 flex items-center gap-3 rounded-xl2 bg-accent-soft px-4 py-3 text-sm text-accent-ink"
      >
        <SparkIcon className="h-[18px] w-[18px] flex-none" />
        <span className="flex-1 font-medium">
          Free trial · {access.daysLeft} day{access.daysLeft === 1 ? "" : "s"} left
        </span>
        <span className="flex items-center gap-0.5 font-medium">
          See plans
          <ChevronRightIcon className="h-4 w-4" />
        </span>
      </Link>
    );
  }
  if (access?.kind === "subscribed" && access.subscription.status === "past_due") {
    return (
      <Link href="/account#plan" className="mb-5 flex items-center gap-3 rounded-xl2 bg-danger-soft px-4 py-3 text-sm text-danger">
        <AlertIcon className="h-[18px] w-[18px] flex-none" />
        <span className="flex-1 font-medium">Your last payment didn&apos;t go through. Update it to keep Campus OS.</span>
        <ChevronRightIcon className="h-4 w-4 flex-none" />
      </Link>
    );
  }
  return null;
}

export async function AppShell({
  active,
  userName,
  children,
}: {
  active: string;
  userName: string;
  children: React.ReactNode;
}) {
  // The LMS entry is named for the one the student connected ("Brightspace"),
  // and its pages all pass active="/connect".
  const user = await getCurrentUser();
  const lms = user ? await lmsNavItem(user.id) : { href: "/connect", label: "Connect classes" };
  const connections = [
    { href: "/email", label: "Email", Icon: MailIcon, match: "/email" },
    { href: lms.href, label: lms.label, Icon: LayersIcon, match: "/connect" },
  ];

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* A soft wash of the brand colors at the top of the canvas. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] lg:left-64">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 70% at 15% 0%, var(--glow-1), transparent 70%), radial-gradient(50% 60% at 90% 0%, var(--glow-2), transparent 70%)",
          }}
        />
      </div>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border-soft bg-surface lg:flex">
        <div className="flex h-16 flex-none items-center px-5">
          <Link href="/dashboard" aria-label="Campus OS home">
            <Logo />
          </Link>
        </div>
        <div className="px-3 pt-1">
          <Link href="/record" aria-current={active === "/record" ? "page" : undefined} className="btn btn-brand w-full">
            <MicIcon className="h-[18px] w-[18px]" />
            Record a lecture
          </Link>
        </div>
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
                {initials(userName)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{userName}</span>
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
      <header className="glass sticky top-0 z-30 border-b border-border-soft pt-[env(safe-area-inset-top)] lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" aria-label="Campus OS home" className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="text-[15px] font-semibold tracking-tight">Campus OS</span>
          </Link>
          <Link
            href="/account"
            aria-label="Account"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-soft ring-1 ring-border"
          >
            {initials(userName) || <UserIcon className="h-4 w-4" />}
          </Link>
        </div>
      </header>

      <div className="relative z-10 lg:pl-64">
        {/* Bottom padding keeps the last thing on a page above the tab bar. */}
        <main className="mx-auto max-w-6xl px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
          <NativeAppBridge />
          <BillingBanner />
          {children}
        </main>
      </div>
      <MobileNav active={active} lms={lms} />
    </div>
  );
}

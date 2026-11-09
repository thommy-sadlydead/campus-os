import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";

// One row of a settings list (Account): a title and a short status, opening
// in place to the setting itself. Plain <details>, so it works without
// JavaScript; OpenFromHash opens the one a link points at (/account#features).

export function SettingsRow({
  id,
  icon,
  title,
  status,
  danger = false,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  /** "On", "6 on", an app's name: what's set now, shown on the closed row. */
  status?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className="group scroll-mt-24">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className={`flex-none ${danger ? "text-danger" : "text-ink"}`}>{icon}</span>
        <span className={`flex-1 text-[15px] font-semibold ${danger ? "text-danger" : "text-ink"}`}>{title}</span>
        {status && <span className="truncate text-[13px] text-ink-soft">{status}</span>}
        <ChevronDownIcon className="h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

/** A settings row that goes to another page. */
export function SettingsLinkRow({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-surface-2">
      <span className="flex-none text-ink">{icon}</span>
      <span className="flex-1 text-[15px] font-semibold text-ink">{title}</span>
      <ChevronRightIcon className="h-4 w-4 flex-none text-ink-faint" />
    </Link>
  );
}

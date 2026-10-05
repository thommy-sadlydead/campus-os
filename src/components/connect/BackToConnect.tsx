import Link from "next/link";
import { ChevronLeftIcon } from "@/components/icons";

/** Back to the Connect page, above each LMS's own page. */
export function BackToConnect() {
  return (
    <Link
      href="/connect"
      className="-ml-1 mb-3 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      Connect
    </Link>
  );
}

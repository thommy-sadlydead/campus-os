import Link from "next/link";
import { ShellChrome } from "@/components/ShellChrome";
import { NativeAppBridge } from "@/components/NativeAppBridge";
import { getCurrentUser } from "@/lib/auth";
import { getAccess, paymentsEnabled } from "@/lib/billing-server";
import { lmsNavItem } from "@/lib/lms/connections";
import { featuresFor } from "@/lib/features-server";
import { FeaturesProvider } from "@/components/FeaturesProvider";
import { AlertIcon, ChevronRightIcon, SparkIcon } from "@/components/icons";

// Every signed-in page's frame (src/components/ShellChrome.tsx), filled in
// with the student's name, their LMS and which optional features are on.

/** During the free trial, or when a renewal payment failed. */
async function BillingBanner() {
  const user = paymentsEnabled() ? await getCurrentUser() : null;
  const access = user ? await getAccess(user.id) : null;
  if (access?.kind === "trial") {
    return (
      // /subscribe has no loading screen, so a prefetch would render all of it.
      <Link
        prefetch={false}
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
  // and its pages all pass active="/connect". Both lookups are cached for the
  // request, so a page that already asked for them pays nothing here.
  const user = await getCurrentUser();
  const [lms, features] = user
    ? await Promise.all([lmsNavItem(user.id), featuresFor(user)])
    : [{ href: "/connect", label: "Connect classes" }, new Set<never>()];

  return (
    <ShellChrome active={active} nav={{ userName, lms, email: features.has("email"), record: features.has("lectures") }}>
      <NativeAppBridge />
      <BillingBanner />
      <FeaturesProvider features={[...features]}>{children}</FeaturesProvider>
    </ShellChrome>
  );
}

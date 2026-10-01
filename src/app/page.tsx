import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";
import { Logo } from "@/components/Logo";
import { BrandBackdrop } from "@/components/ui/BrandBackdrop";
import { ArrowRightIcon, LayersIcon, MailIcon, MicIcon, SparkIcon } from "@/components/icons";

// Signed-in users go straight to their dashboard. Everyone else gets a
// public page saying what Campus OS is: Google's OAuth verification needs a
// homepage that isn't just a login form and links the privacy policy.

const FEATURES = [
  { Icon: LayersIcon, text: "Classes, assignments, due dates and course files synced from Canvas" },
  { Icon: SparkIcon, text: "A dashboard that tells you what to work on next" },
  { Icon: MailIcon, text: "School email from Gmail, sorted by class, with date changes flagged for you to approve" },
  { Icon: MicIcon, text: "Lecture recordings turned into transcripts and notes" },
];

export default async function RootPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen flex-col bg-bg text-ink">
      <BrandBackdrop />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6">
        <Logo />
        <Link href="/login" className="btn btn-secondary btn-sm">
          Log in
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Campus OS</p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.08] sm:text-5xl">
            Your classes, assignments, email and lecture notes <span className="text-brand">in one place.</span>
          </h1>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/login" className="btn btn-primary btn-lg">
              Log in
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <span className="text-sm text-ink-faint">
              {isSignupOpen() ? "New accounts need an invite code." : "Campus OS is invite-only right now."}
            </span>
          </div>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map(({ Icon, text }) => (
            <li key={text} className="card flex items-start gap-3.5 p-5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <p className="pt-1.5 text-sm leading-relaxed text-ink-soft">{text}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <Link href="/privacy" className="text-xs text-ink-faint hover:text-ink hover:underline">
          Privacy policy
        </Link>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";

// Signed-in users go straight to their dashboard. Everyone else gets a
// public page saying what Campus OS is: Google's OAuth verification needs a
// homepage that isn't just a login form and links the privacy policy.

const FEATURES = [
  "Classes, assignments, due dates and course files synced from Canvas",
  "A dashboard that tells you what to work on next",
  "School email from Gmail, sorted by class, with date changes flagged for you to approve",
  "Lecture recordings turned into transcripts and notes",
  "Voicewrite, a writing helper that writes in your own style",
];

export default async function RootPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-ink">
      <main className="w-full max-w-lg">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Campus OS</div>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">
          Your classes, assignments, email and lecture notes in one place.
        </h1>
        <ul className="mt-6 flex flex-col gap-2 text-sm text-ink-soft">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden className="text-ink-faint">
                •
              </span>
              {feature}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90"
          >
            Log in
          </Link>
          <span className="text-sm text-ink-faint">
            {isSignupOpen() ? "New accounts need an invite code." : "Campus OS is invite-only right now."}
          </span>
        </div>
        <p className="mt-10 text-xs text-ink-faint">
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Privacy policy
          </Link>
        </p>
      </main>
    </div>
  );
}

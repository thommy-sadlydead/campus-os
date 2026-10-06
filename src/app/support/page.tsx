import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TRIAL_DAYS } from "@/lib/billing";

export const metadata: Metadata = { title: "Support · Campus OS" };

// Public on purpose: it's the App Store listing's Support URL, which has to
// show a way to reach the developer. The address is CONTACT_EMAIL, the same
// one the privacy policy and terms show. Keep the answers in step with the
// app's own wording (the connect pages, Account, the Subscribe screen).

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const LINK = "font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink";

export default function SupportPage() {
  const contactEmail = process.env.CONTACT_EMAIL?.trim();

  return (
    <div className="min-h-screen bg-bg px-4 pb-12 pt-[calc(1.25rem+env(safe-area-inset-top))] text-ink">
      <nav className="mx-auto mb-8 flex max-w-3xl items-center">
        <Link href="/" aria-label="Campus OS home">
          <Logo />
        </Link>
      </nav>
      <article className="card mx-auto flex max-w-3xl flex-col gap-8 p-6 text-sm leading-relaxed text-ink-soft sm:p-10">
        <header>
          <p className="eyebrow">Help</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">Support</h1>
          {contactEmail ? (
            <p className="mt-4">
              Something not working, or a question about your account or subscription? Email{" "}
              <a href={`mailto:${contactEmail}`} className={LINK}>
                {contactEmail}
              </a>{" "}
              from the address you sign in with, and say what you were doing when it went wrong.
            </p>
          ) : (
            <p className="mt-4">Answers to common questions about Campus OS.</p>
          )}
        </header>

        <Section title="Connecting your school">
          <p>
            Campus OS works with Canvas, Schoology, D2L Brightspace and Blackboard. After you sign in, open Connect and
            pick the system your school uses; each one walks you through it. Campus OS only reads from it. It can&apos;t
            submit, change or delete anything there.
          </p>
          <p>
            Canvas and Schoology bring in your assignments and their directions, whether you&apos;ve turned work in, and
            course files. Brightspace and Blackboard connect through your calendar feed, which has due dates and exams
            but not directions, submissions or files.
          </p>
        </Section>

        <Section title="A class or assignment is missing">
          <p>
            The Connect page shows what the last sync brought in and, for any class it couldn&apos;t, why. Fix what it
            points to and sync again from there.
          </p>
        </Section>

        <Section title="Free trial and subscriptions">
          <p>New accounts get a {TRIAL_DAYS}-day free trial, then a monthly or yearly subscription.</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="text-ink">Bought in the iPhone or iPad app:</strong> Apple bills it. Manage or cancel
              it in your device&apos;s Settings → your name → Subscriptions. After reinstalling, or on a new device, tap
              Restore purchases on the Subscribe screen.
            </li>
            <li>
              <strong className="text-ink">Bought on the website:</strong> manage or cancel it under Account → Manage
              billing. You keep access until the period you paid for ends.
            </li>
          </ul>
        </Section>

        <Section title="AI features">
          <p>
            Some features, like lecture notes and the class assistant, use outside AI services. Campus OS asks before
            sending anything to them, and you can turn them off under Account → AI features.
          </p>
        </Section>

        <Section title="Deleting your account">
          <p>
            Account → Delete account permanently deletes your account and everything in it. It cancels a website
            subscription; one bought in the app has to be canceled in your device&apos;s Settings first.
          </p>
        </Section>

        <Section title="Privacy and terms">
          <p>
            The{" "}
            <Link href="/privacy" className={LINK}>
              privacy policy
            </Link>{" "}
            covers what Campus OS stores and which outside services see your data. The{" "}
            <Link href="/terms" className={LINK}>
              terms of use
            </Link>{" "}
            cover the free trial and subscriptions.
          </p>
        </Section>
      </article>
    </div>
  );
}

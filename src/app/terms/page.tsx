import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TRIAL_DAYS } from "@/lib/billing";

export const metadata: Metadata = { title: "Terms of Use · Campus OS" };

// Public: Apple requires a Terms of Use link wherever auto-renewing
// subscriptions are sold (the subscribe page and the App Store listing).
// Keep the subscription section in step with src/lib/billing.ts.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
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
          <p className="eyebrow">Legal</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">Terms of Use</h1>
          <p className="mt-1 text-xs text-ink-faint">Last updated October 2, 2026</p>
          <p className="mt-4">
            These terms cover your use of Campus OS on the website and in the iPhone and iPad app. By creating an
            account you agree to them. The{" "}
            <Link href="/privacy" className="font-medium text-ink underline decoration-border underline-offset-2">
              privacy policy
            </Link>{" "}
            explains what Campus OS stores and shares.
          </p>
        </header>

        <Section title="What Campus OS is">
          <p>
            Campus OS is a personal academic organizer. It brings in your classes and assignments from Canvas, can read
            school email from Gmail, and turns lecture recordings into notes. It&apos;s a study aid: always check due
            dates, grades and instructions with your school and instructors. Notes, summaries and suggestions written by
            AI can be wrong or incomplete.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You need to be at least 13 years old (or the minimum age where you live) to use Campus OS. Keep your password
            to yourself; you&apos;re responsible for what happens under your account. One account is for one person.
          </p>
        </Section>

        <Section title="Free trial and subscriptions">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              A new account is free for {TRIAL_DAYS} days, with no payment details needed. After that, Campus OS needs a
              monthly or yearly subscription. The price is shown before you buy.
            </li>
            <li>
              <strong className="text-ink">Bought in the iPhone or iPad app:</strong> Apple bills your Apple ID under
              its own terms. The subscription renews automatically at the same price unless you cancel at least 24 hours
              before the current period ends, in your device&apos;s Settings → your name → Subscriptions. Refunds are
              handled by Apple.
            </li>
            <li>
              <strong className="text-ink">Bought on the website:</strong> Stripe bills your card at the start of each
              period until you cancel, which you can do anytime under Account → Manage billing. You keep access until
              the end of the period you paid for. Partial periods aren&apos;t refunded, except where the law requires it.
            </li>
            <li>
              If the price changes, you&apos;ll be told before it applies to you, and you can cancel before then.
            </li>
            <li>
              Free-access codes are given out by Campus OS at its discretion. They&apos;re personal and can&apos;t be
              sold.
            </li>
          </ul>
        </Section>

        <Section title="Your content">
          <p>
            Your notes, recordings, files and other content stay yours. You allow Campus OS to store and process them to
            run the service, including sending them to the AI services named in the privacy policy when you&apos;ve
            turned AI features on. Only record lectures where you&apos;re allowed to: check your school&apos;s and your
            instructors&apos; rules.
          </p>
        </Section>

        <Section title="Canvas and Gmail">
          <p>
            When you connect Canvas or Gmail, you let Campus OS read from them on your behalf. Their own terms still
            apply to your use of those services, and you can disconnect either one at any time.
          </p>
        </Section>

        <Section title="Fair use">
          <p>
            Don&apos;t misuse Campus OS: no attempts to get around its limits or payments, to break or overload it, to
            access other people&apos;s accounts, or to use it for anything illegal. Campus OS can suspend an account
            that does.
          </p>
        </Section>

        <Section title="Ending your account">
          <p>
            You can delete your account at any time under Account → Delete account, which removes your data as the
            privacy policy describes. Deleting an account cancels a website subscription; one bought in the app has to
            be canceled in your device&apos;s Settings.
          </p>
        </Section>

        <Section title="No guarantees">
          <p>
            Campus OS is provided as is. It may have mistakes or downtime, and it isn&apos;t responsible for missed
            deadlines, grades or decisions made from what it shows. To the extent the law allows, its total liability to
            you is limited to what you paid for Campus OS in the 12 months before the claim.
          </p>
        </Section>

        <Section title="Changes">
          <p>If these terms change, the date at the top changes with it, and important changes are announced in the app.</p>
        </Section>

        {contactEmail && (
          <Section title="Contact">
            <p>
              Questions about these terms: <span className="text-ink">{contactEmail}</span>
            </p>
          </Section>
        )}
      </article>
    </div>
  );
}

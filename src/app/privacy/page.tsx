import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy · Campus OS" };

// Public on purpose: Google's OAuth verification requires a privacy policy
// anyone can read, linked from the homepage. Keep this in sync with what the
// code actually stores and sends; the Gmail section in particular mirrors
// syncEmailAction (src/app/email/actions.ts).

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const contactEmail = process.env.CONTACT_EMAIL?.trim();

  return (
    <div className="min-h-screen bg-bg px-4 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))] text-ink">
      <article className="mx-auto flex max-w-2xl flex-col gap-7 text-sm leading-relaxed text-ink-soft">
        <header>
          <Link href="/" className="text-xs font-semibold uppercase tracking-wider text-ink-faint hover:text-ink">
            Campus OS
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold text-ink">Privacy policy</h1>
          <p className="mt-1 text-xs text-ink-faint">Last updated September 30, 2026</p>
          <p className="mt-4">
            Campus OS is a personal academic organizer. It pulls your classes and assignments from Canvas, reads
            school-related email from Gmail if you connect it, and turns lecture recordings into notes. This page
            covers what it stores, which outside services see your data, and how to delete it.
          </p>
        </header>

        <Section title="What Campus OS stores">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="text-ink">Your account:</strong> your email address, your password as a bcrypt hash
              (never the password itself), your time zone, and your name if you add one.
            </li>
            <li>
              <strong className="text-ink">Canvas, if you connect it:</strong> your Canvas address and access token
              (encrypted), your courses, assignments, due dates and submission status, and the text of course files,
              pages and syllabi it imports. Files you upload yourself keep only their text; the file is deleted once
              the text is read.
            </li>
            <li>
              <strong className="text-ink">Gmail, if you connect it:</strong> read-only access tokens (encrypted). Each
              sync reads the inbox messages from the last 60 days that it hasn&apos;t seen yet. For school-related
              messages it keeps the sender, subject, date, a short summary and the message text. For everything else it
              keeps only the sender, subject and date, so it can skip that message next time.
            </li>
            <li>
              <strong className="text-ink">Lectures:</strong> audio you record in the app or upload, stored in Vercel
              Blob at a hard-to-guess link, plus its transcript and the notes generated from it. Campus OS uses your
              microphone only while you&apos;re recording, and only after you allow it.
            </li>
            <li>
              <strong className="text-ink">What you add yourself:</strong> notes, schedule, resources, exams and
              availability.
            </li>
          </ul>
        </Section>

        <Section title="Outside services">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="text-ink">Vercel</strong> hosts the app and stores lecture audio.
            </li>
            <li>
              <strong className="text-ink">Prisma Postgres</strong> hosts the database.
            </li>
            <li>
              <strong className="text-ink">Anthropic (Claude)</strong> writes AI answers, lecture notes and
              assignment breakdowns, sorts email, and reads scanned PDFs. It receives only what each feature
              needs, such as a class&apos;s notes and assignments, an email&apos;s text, or a lecture transcript.
              Anthropic{" "}
              <a
                href="https://privacy.anthropic.com/en/articles/7996868-i-want-to-opt-out-of-my-prompts-and-results-being-used-for-training-models"
                className="underline hover:text-ink"
              >
                doesn&apos;t train its models on API data
              </a>{" "}
              by default.
            </li>
            <li>
              <strong className="text-ink">AssemblyAI</strong> transcribes lecture audio. Campus OS deletes each
              transcript from AssemblyAI as soon as it&apos;s saved in Campus OS.
            </li>
            <li>
              Anthropic and AssemblyAI get nothing until you allow AI features, which Campus OS asks before you
              first use one. You can turn them off any time under Account → AI features; with them off, email is
              sorted without AI and nothing is sent to either service.
            </li>
            <li>
              <strong className="text-ink">Google (Gmail)</strong> and <strong className="text-ink">your school&apos;s
              Canvas</strong> are where your data comes from. Campus OS only reads from them. It can&apos;t send,
              delete or change your email, or change anything in Canvas.
            </li>
          </ul>
          <p>Campus OS doesn&apos;t sell your data, show ads, or use your data to train AI models.</p>
        </Section>

        <Section title="Google user data">
          <p>
            Campus OS&apos;s use and transfer to any other app of information received from Google APIs will adhere
            to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="underline hover:text-ink"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Gmail data is used only to show you your school-related email
            and to suggest schedule changes that you approve.
          </p>
        </Section>

        <Section title="Deleting your data">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="text-ink">Everything:</strong> Account → Delete account. This removes your account
              and all of its data, deletes your lecture audio and any transcripts still at AssemblyAI, and revokes
              Campus OS&apos;s Gmail access at Google.
            </li>
            <li>
              <strong className="text-ink">Gmail only:</strong> Email → Disconnect deletes the stored tokens and
              revokes access at Google. You can also remove Campus OS at{" "}
              <a href="https://myaccount.google.com/permissions" className="underline hover:text-ink">
                myaccount.google.com/permissions
              </a>
              .
            </li>
            <li>
              <strong className="text-ink">Canvas only:</strong> Canvas → Disconnect deletes the stored token. Delete
              the token in Canvas as well, under Account → Settings → Approved Integrations.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            Passwords are hashed with bcrypt. Canvas and Gmail tokens are encrypted with AES-256-GCM. Sessions are
            stored as keyed hashes, so a copy of the database alone can&apos;t sign anyone in. All traffic uses HTTPS.
          </p>
        </Section>

        {contactEmail && (
          <Section title="Contact">
            <p>
              Questions or requests about your data: <span className="text-ink">{contactEmail}</span>
            </p>
          </Section>
        )}

        <Section title="Changes">
          <p>If this policy changes, the date at the top changes with it.</p>
        </Section>
      </article>
    </div>
  );
}

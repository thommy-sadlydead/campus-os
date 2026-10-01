import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/account/AccountForms";
import { AiFeaturesSettings } from "@/components/account/AiConsent";
import { formatInTimeZone } from "date-fns-tz";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <AppShell active="/account" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Account</h1>
      <p className="mb-6 text-sm text-ink-soft">Signed in as {user.email}</p>

      <div className="flex max-w-xl flex-col gap-6">
        <section id="ai" className="rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
          <h2 className="font-display text-base font-semibold">AI features</h2>
          <AiFeaturesSettings
            allowedSince={user.aiConsentAt ? formatInTimeZone(user.aiConsentAt, user.timezone, "MMM d, yyyy") : null}
          />
        </section>

        <section className="rounded-xl2 border border-border-soft bg-surface p-6 shadow-card">
          <h2 className="font-display text-base font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-ink-soft">Changing it signs you out everywhere except this device.</p>
          <ChangePasswordForm />
        </section>

        <section className="rounded-xl2 border border-danger bg-surface p-6 shadow-card">
          <h2 className="font-display text-base font-semibold text-danger">Delete account</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Permanently deletes your account and everything in it: classes, assignments, notes, lectures and their audio,
            emails, and your Canvas and Gmail connections. Gmail access is revoked at Google, and lecture transcripts
            are deleted from the transcription service. This can&apos;t be undone.
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Your Canvas access token lives in Canvas too. Delete it there under Account → Settings → Approved
            Integrations. See the{" "}
            <Link href="/privacy" className="underline hover:text-ink">
              privacy policy
            </Link>{" "}
            for details.
          </p>
          <DeleteAccountForm />
        </section>
      </div>
    </AppShell>
  );
}

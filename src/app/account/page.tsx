import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/account/AccountForms";
import { AiFeaturesSettings } from "@/components/account/AiConsent";
import { formatInTimeZone } from "date-fns-tz";
import { getAccess, isAppRequest, paymentsEnabled } from "@/lib/billing-server";
import { PlanSection } from "@/components/billing/PlanSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardHeader } from "@/components/ui/CardHeader";
import { AlertIcon, LockIcon, SparkIcon } from "@/components/icons";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  // Reachable after a trial ends, so the account can subscribe or be deleted.
  const user = await requireUser({ allowWithoutAccess: true });
  const { subscribed } = await searchParams;
  const payments = paymentsEnabled();
  const [access, inApp] = payments ? await Promise.all([getAccess(user.id), isAppRequest()]) : [null, false];

  return (
    <AppShell active="/account" userName={user.name ?? user.email}>
      <PageHeader title="Account" description={`Signed in as ${user.email}`} />

      <div className="flex max-w-2xl flex-col gap-6">
        {access && <PlanSection access={access} inApp={inApp} timezone={user.timezone} justSubscribed={subscribed === "1"} />}

        <section id="ai" className="card card-pad scroll-mt-24">
          <CardHeader icon={<SparkIcon className="h-[18px] w-[18px]" />} title="AI features" />
          <AiFeaturesSettings
            allowedSince={user.aiConsentAt ? formatInTimeZone(user.aiConsentAt, user.timezone, "MMM d, yyyy") : null}
          />
        </section>

        <section className="card card-pad">
          <CardHeader
            icon={<LockIcon className="h-[18px] w-[18px]" />}
            title="Change password"
            description="Changing it signs you out everywhere except this device."
          />
          <ChangePasswordForm />
        </section>

        <section className="card card-pad">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-danger-soft text-danger">
              <AlertIcon className="h-[18px] w-[18px]" />
            </span>
            <h2 className="pt-2 text-[15px] font-semibold leading-snug text-danger">Delete account</h2>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Permanently deletes your account and everything in it: classes, assignments, notes, lectures and their audio,
            emails, and your Canvas and Gmail connections. Gmail access is revoked at Google, and lecture transcripts
            are deleted from the transcription service. This can&apos;t be undone.
          </p>
          {payments && (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              A website subscription is canceled along with the account. One bought in the iPhone app is billed by
              Apple, so cancel it first in your iPhone&apos;s Settings → your name → Subscriptions.
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Your Canvas access token lives in Canvas too. Delete it there under Account → Settings → Approved
            Integrations. See the{" "}
            <Link href="/privacy" className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
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

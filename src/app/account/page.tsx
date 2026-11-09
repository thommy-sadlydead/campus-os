import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/account/AccountForms";
import { AiFeaturesSettings } from "@/components/account/AiConsent";
import { formatInTimeZone } from "date-fns-tz";
import { getAccess, isAppRequest, paymentsEnabled } from "@/lib/billing-server";
import { PlanSection } from "@/components/billing/PlanSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsLinkRow, SettingsRow } from "@/components/ui/SettingsRow";
import { OpenFromHash } from "@/components/ui/OpenFromHash";
import { AlertIcon, BookIcon, LayersIcon, LinkIcon, LockIcon, MailIcon, SparkIcon } from "@/components/icons";
import { listConnectedApps } from "@/lib/oauth/oauth-server";
import { formatPastMoment } from "@/lib/time";
import { disconnectAppAction } from "./actions";
import { isDemoAccount } from "@/lib/sample-classes";
import { SampleClassesButton } from "@/components/demo/SampleClassesButton";
import { FeaturePicker } from "@/components/account/FeaturePicker";
import { FEATURE_IDS } from "@/lib/features";
import { availableFeatures, featuresFor } from "@/lib/features-server";
import { hasAiConsent } from "@/lib/ai-consent";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  // Reachable after a trial ends, so the account can subscribe or be deleted.
  const user = await requireUser({ allowWithoutAccess: true });
  const { subscribed } = await searchParams;
  const payments = paymentsEnabled();
  const [access, inApp] = payments ? await Promise.all([getAccess(user.id), isAppRequest()]) : [null, false];
  const [connectedApps, available, features] = await Promise.all([listConnectedApps(user.id), availableFeatures(user), featuresFor(user)]);
  const now = new Date();

  return (
    <AppShell active="/account" userName={user.name ?? user.email}>
      <PageHeader title="Account" description={`Signed in as ${user.email}`} />

      {/* A list of rows that open in place, not a stack of cards (Nov 9,
          2026: the page ran five phone screens). The plan stays open on top. */}
      <OpenFromHash />
      <div className="flex max-w-2xl flex-col gap-6">
        {access && <PlanSection access={access} inApp={inApp} timezone={user.timezone} justSubscribed={subscribed === "1"} />}

        <div className="card divide-y divide-border-soft overflow-hidden p-0">
          {isDemoAccount(user.email) && (
            <SettingsRow icon={<BookIcon className="h-[18px] w-[18px]" />} title="Sample classes" status="Review account">
              <p className="text-sm leading-relaxed text-ink-soft">
                This is the App Store review account. Resetting replaces the made-up classes with fresh ones, dated from
                today, and restarts the free trial.
              </p>
              <div className="mt-4">
                <SampleClassesButton label="Reset sample classes" />
              </div>
            </SettingsRow>
          )}

          <SettingsRow
            id="features"
            icon={<LayersIcon className="h-[18px] w-[18px]" />}
            title="Features"
            status={`${features.size} of ${FEATURE_IDS.filter(available).length} on`}
          >
            <p className="text-sm leading-relaxed text-ink-soft">
              Turn on what you use and turn off what you don&apos;t. Anything you turn off keeps its data, so turning it
              back on picks up where you left off.
            </p>
            <div className="mt-5">
              <FeaturePicker initial={[...features]} available={FEATURE_IDS.filter(available)} aiAllowed={hasAiConsent(user)} mode="account" />
            </div>
          </SettingsRow>

          <SettingsRow id="ai" icon={<SparkIcon className="h-[18px] w-[18px]" />} title="AI features" status={hasAiConsent(user) ? "On" : "Off"}>
            <AiFeaturesSettings
              allowedSince={user.aiConsentAt ? formatInTimeZone(user.aiConsentAt, user.timezone, "MMM d, yyyy") : null}
            />
          </SettingsRow>

          {connectedApps.length > 0 && (
            <SettingsRow
              id="connected-apps"
              icon={<LinkIcon className="h-[18px] w-[18px]" />}
              title="Connected apps"
              status={connectedApps.map((app) => app.clientName).join(", ")}
            >
              <p className="text-sm leading-relaxed text-ink-soft">
                Apps you&apos;ve let read your classes, assignments, notes and course files. They can&apos;t change anything.
              </p>
              <ul className="mt-4 divide-y divide-border-soft">
                {connectedApps.map((app) => (
                  <li key={app.clientId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{app.clientName}</p>
                      <p className="text-xs text-ink-faint">
                        Connected {formatPastMoment(app.connectedAt, now, user.timezone)}
                        {app.lastUsedAt ? ` · last used ${formatPastMoment(app.lastUsedAt, now, user.timezone)}` : ""}
                      </p>
                    </div>
                    <form action={disconnectAppAction}>
                      <input type="hidden" name="clientId" value={app.clientId} />
                      <button className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger">Disconnect</button>
                    </form>
                  </li>
                ))}
              </ul>
            </SettingsRow>
          )}

          <SettingsRow id="password" icon={<LockIcon className="h-[18px] w-[18px]" />} title="Change password">
            <p className="text-sm leading-relaxed text-ink-soft">
              Changing it signs you out everywhere except this device, and disconnects connected apps.
            </p>
            <ChangePasswordForm />
          </SettingsRow>

          <SettingsLinkRow href="/support" icon={<MailIcon className="h-[18px] w-[18px]" />} title="Help and support" />
        </div>

        <div className="card overflow-hidden p-0">
          <SettingsRow id="delete" icon={<AlertIcon className="h-[18px] w-[18px]" />} title="Delete account" danger>
            <p className="text-sm leading-relaxed text-ink-soft">
              Permanently deletes your account and everything in it: classes, assignments, notes, lectures and their audio,
              emails, your school and Gmail connections, and any connected apps like ChatGPT. Gmail access is revoked at Google, and lecture transcripts
              are deleted from the transcription service. This can&apos;t be undone.
            </p>
            {payments && (
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                A website subscription is canceled along with the account. One bought in the iPhone, iPad or Mac app is
                billed by Apple, so cancel it first: on an iPhone or iPad, Settings → your name → Subscriptions; on a
                Mac, the App Store → your name → Account Settings → Subscriptions.
              </p>
            )}
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              If you connected Canvas, your access token lives in Canvas too. Delete it there under Account → Settings →
              Approved Integrations. See the{" "}
              <Link href="/privacy" className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
                privacy policy
              </Link>{" "}
              for details.
            </p>
            <DeleteAccountForm />
          </SettingsRow>
        </div>
      </div>
    </AppShell>
  );
}

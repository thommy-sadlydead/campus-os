import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { FeaturePicker } from "@/components/account/FeaturePicker";
import { FEATURE_IDS } from "@/lib/features";
import { availableFeatures, featuresFor } from "@/lib/features-server";
import { hasAiConsent } from "@/lib/ai-consent";

// Right after sign-up (registerAction sends new accounts here with ?new=1),
// and from Today's "Pick your features" card: the student checks what they
// want, then goes to Today. Account → Features has the same picker.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const { new: isNew } = await searchParams;
  const available = await availableFeatures(user);
  // A new account starts with nothing checked; anyone else starts from what they have.
  const initial = isNew === "1" && !user.featuresChosenAt ? [] : [...(await featuresFor(user))];

  return (
    <AppShell active="/dashboard" userName={user.name ?? user.email}>
      <div className="mx-auto max-w-2xl pt-2 sm:pt-6">
        <div className="card card-pad sm:p-8">
          <p className="eyebrow">Welcome to Campus OS</p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold text-ink sm:text-[28px]">Pick what you want to use</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            Check the features you want. You can start small: anything you leave off stays out of your way, and you can turn
            it on later.
          </p>
          <div className="mt-6">
            <FeaturePicker initial={initial} available={FEATURE_IDS.filter(available)} aiAllowed={hasAiConsent(user)} mode="welcome" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

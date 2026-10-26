import { inviteCodeRequired, isSignupOpen } from "@/lib/signup";
import { paymentsEnabled } from "@/lib/billing-server";
import { TRIAL_DAYS } from "@/lib/billing";
import { safeNextPath } from "@/lib/oauth/oauth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ deleted?: string; next?: string }> }) {
  const { deleted, next } = await searchParams;
  return (
    <LoginForm
      // Where to go after logging in, e.g. back to connecting ChatGPT
      // (/oauth/authorize). Only paths on this site (safeNextPath).
      next={safeNextPath(next) ?? undefined}
      signupOpen={isSignupOpen()}
      inviteRequired={inviteCodeRequired()}
      trialDays={paymentsEnabled() ? TRIAL_DAYS : null}
      // The seeded demo account (prisma/seed.ts) is for local development
      // only. Its credentials are public in this repo, so they're never
      // shown on a deployed site.
      showDemoHint={process.env.NODE_ENV === "development"}
      notice={deleted ? "Your account and all of its data have been deleted." : null}
    />
  );
}

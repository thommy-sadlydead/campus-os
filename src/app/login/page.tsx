import { isSignupOpen } from "@/lib/signup";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <LoginForm
      signupOpen={isSignupOpen()}
      // The seeded demo account (prisma/seed.ts) is for local development
      // only. Its credentials are public in this repo, so they're never
      // shown on a deployed site.
      showDemoHint={process.env.NODE_ENV === "development"}
      notice={deleted ? "Your account and all of its data have been deleted." : null}
    />
  );
}

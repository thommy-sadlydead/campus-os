"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { loginAction, registerAction, type AuthActionState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/account-forms";

const INPUT_CLASS =
  "rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Please wait…" : label}
    </button>
  );
}

function Field({
  id,
  label,
  ...inputProps
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-soft">
        {label}
      </label>
      <input id={id} name={id} className={INPUT_CLASS} {...inputProps} />
    </div>
  );
}

export function LoginForm({
  signupOpen,
  showDemoHint,
  notice,
}: {
  signupOpen: boolean;
  showDemoHint: boolean;
  notice: string | null;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginState, loginFormAction] = useActionState<AuthActionState, FormData>(loginAction, undefined);
  const [registerState, registerFormAction] = useActionState<AuthActionState, FormData>(registerAction, undefined);

  const registering = signupOpen && mode === "register";
  const state = registering ? registerState : loginState;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl2 border border-border-soft bg-surface p-8 shadow-card">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Campus OS</div>
        <h1 className="mb-6 font-display text-2xl font-semibold">
          {registering ? "Create your account" : "Welcome back"}
        </h1>

        {notice && <p className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}

        <form
          // Remounts the form when switching modes so each one starts from
          // its own saved state instead of the other mode's leftovers.
          key={registering ? "register" : "login"}
          action={registering ? registerFormAction : loginFormAction}
          className="flex flex-col gap-4"
        >
          <Field
            id="email"
            label="School email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@school.edu"
            defaultValue={state?.email ?? ""}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            required
            minLength={registering ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={registering ? "new-password" : "current-password"}
            placeholder="••••••••"
          />
          {registering && (
            <>
              <Field
                id="confirmPassword"
                label="Confirm password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <Field id="inviteCode" label="Invite code" type="text" required autoComplete="off" />
            </>
          )}

          {state?.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}

          <SubmitButton label={registering ? "Create account" : "Log in"} />
        </form>

        {signupOpen ? (
          <button
            onClick={() => setMode(registering ? "login" : "register")}
            className="mt-4 w-full text-center text-sm text-ink-soft hover:text-ink"
          >
            {registering ? "Already have an account? Log in" : "Have an invite code? Create an account"}
          </button>
        ) : (
          <p className="mt-4 text-center text-sm text-ink-faint">Campus OS is invite-only right now.</p>
        )}

        {showDemoHint && (
          <p className="mt-6 text-xs leading-relaxed text-ink-faint">
            Local demo login (from <code>npm run db:seed</code>):{" "}
            <code className="font-mono">student@example.com</code> /{" "}
            <code className="font-mono">campusos-demo</code>
          </p>
        )}

        <p className="mt-6 text-center text-xs text-ink-faint">
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Privacy policy
          </Link>
        </p>
      </div>
    </div>
  );
}

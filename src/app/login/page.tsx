"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction, registerAction, type AuthActionState } from "./actions";

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

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginState, loginFormAction] = useFormState<AuthActionState, FormData>(loginAction, undefined);
  const [registerState, registerFormAction] = useFormState<AuthActionState, FormData>(
    registerAction,
    undefined
  );

  const state = mode === "login" ? loginState : registerState;
  const action = mode === "login" ? loginFormAction : registerFormAction;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl2 border border-border-soft bg-surface p-8 shadow-card">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Campus OS
        </div>
        <h1 className="mb-6 font-display text-2xl font-semibold">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>

        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-ink-soft">
              School email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="you@school.edu"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-ink-soft">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          {state?.error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
          )}

          <SubmitButton label={mode === "login" ? "Log in" : "Create account"} />
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="mt-4 w-full text-center text-sm text-ink-soft hover:text-ink"
        >
          {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
        </button>

        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          Demo login (from <code>npm run db:seed</code>):{" "}
          <code className="font-mono">student@example.com</code> /{" "}
          <code className="font-mono">campusos-demo</code>
        </p>
      </div>
    </div>
  );
}

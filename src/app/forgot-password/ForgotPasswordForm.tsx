"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestPasswordResetAction, type ForgotPasswordState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary btn-lg mt-1 w-full">
      {pending ? "Sending…" : "Send reset link"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ForgotPasswordState, FormData>(requestPasswordResetAction, undefined);

  if (state?.sent) {
    return <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm leading-relaxed text-ok">{state.sent}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col">
        <label htmlFor="email" className="field-label">
          School email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@school.edu"
          defaultValue={state?.email ?? ""}
          className="field"
        />
      </div>
      {state?.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}

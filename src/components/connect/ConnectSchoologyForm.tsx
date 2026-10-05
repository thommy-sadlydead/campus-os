"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connectSchoologyAction, type ConnectSchoologyState } from "@/app/connect/schoology/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full">
      {pending ? "Connecting…" : "Connect Schoology"}
    </button>
  );
}

export function ConnectSchoologyForm() {
  const [state, formAction] = useActionState<ConnectSchoologyState, FormData>(connectSchoologyAction, undefined);

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <div className="flex flex-col">
        <label htmlFor="domain" className="field-label">
          Schoology address
        </label>
        <input
          id="domain"
          name="domain"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="app.schoology.com"
          defaultValue={state?.domain ?? ""}
          className="field"
        />
        <p className="mt-1.5 text-xs text-ink-faint">The address you use to open Schoology.</p>
      </div>
      <div className="flex flex-col">
        <label htmlFor="consumerKey" className="field-label">
          Consumer key
        </label>
        <input
          id="consumerKey"
          name="consumerKey"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          required
          defaultValue={state?.consumerKey ?? ""}
          className="field"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="consumerSecret" className="field-label">
          Consumer secret
        </label>
        <input
          id="consumerSecret"
          name="consumerSecret"
          type="password"
          autoComplete="off"
          required
          placeholder="Paste your consumer secret"
          className="field"
        />
      </div>

      {state?.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}

      <SubmitButton />
    </form>
  );
}

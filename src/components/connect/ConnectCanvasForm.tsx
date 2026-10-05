"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connectCanvasAction, type ConnectCanvasState } from "@/app/connect/canvas/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary mt-1 w-full"
    >
      {pending ? "Connecting…" : "Connect Canvas"}
    </button>
  );
}

export function ConnectCanvasForm() {
  const [state, formAction] = useActionState<ConnectCanvasState, FormData>(connectCanvasAction, undefined);

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <div className="flex flex-col">
        <label htmlFor="baseUrl" className="field-label">
          Canvas URL
        </label>
        <input
          id="baseUrl"
          name="baseUrl"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="yourschool.instructure.com"
          defaultValue={state?.baseUrl ?? ""}
          className="field"
        />
        <p className="mt-1.5 text-xs text-ink-faint">The address you use to open Canvas.</p>
      </div>
      <div className="flex flex-col">
        <label htmlFor="accessToken" className="field-label">
          Access token
        </label>
        <input
          id="accessToken"
          name="accessToken"
          type="password"
          required
          placeholder="Paste your Canvas access token"
          autoComplete="off"
          className="field"
        />
      </div>

      {state?.error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}

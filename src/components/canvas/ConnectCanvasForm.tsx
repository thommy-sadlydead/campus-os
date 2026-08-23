"use client";

import { useFormState, useFormStatus } from "react-dom";
import { connectCanvasAction, type ConnectCanvasState } from "@/app/canvas/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Connecting…" : "Connect Canvas"}
    </button>
  );
}

export function ConnectCanvasForm({ defaultBaseUrl }: { defaultBaseUrl: string }) {
  const [state, formAction] = useFormState<ConnectCanvasState, FormData>(connectCanvasAction, undefined);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="baseUrl" className="text-xs font-medium text-ink-soft">
          Canvas URL
        </label>
        <input
          id="baseUrl"
          name="baseUrl"
          type="url"
          required
          defaultValue={defaultBaseUrl}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="accessToken" className="text-xs font-medium text-ink-soft">
          Access token
        </label>
        <input
          id="accessToken"
          name="accessToken"
          type="password"
          required
          placeholder="Paste your Canvas access token"
          autoComplete="off"
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      {state?.error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}

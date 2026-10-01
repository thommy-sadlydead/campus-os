"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connectCanvasAction, type ConnectCanvasState } from "@/app/canvas/actions";

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

export function ConnectCanvasForm({ defaultBaseUrl }: { defaultBaseUrl: string }) {
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
          type="url"
          required
          defaultValue={state?.baseUrl ?? defaultBaseUrl}
          className="field"
        />
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

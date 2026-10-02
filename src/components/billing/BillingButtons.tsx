"use client";

import { useActionState, useState, useTransition } from "react";
import { openBillingPortalAction } from "@/app/subscribe/actions";
import { redeemFreeAccessCodeAction, type AccountActionState } from "@/app/account/actions";

/** Website: opens Stripe's billing page (change plan, card, or cancel). */
export function ManageBillingButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={() =>
          startTransition(async () => {
            const result = await openBillingPortalAction();
            if (result?.error) setError(result.error);
          })
        }
        disabled={pending}
        className="btn btn-secondary"
      >
        {pending ? "Opening…" : "Manage billing"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Website only: redeem the free-access code. */
export function FreeAccessCodeForm() {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(redeemFreeAccessCodeAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="free-code" className="field-label mb-0">
        Have a free-access code?
      </label>
      <div className="flex gap-2">
        <input id="free-code" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} className="field" />
        <button type="submit" disabled={pending} className="btn btn-secondary flex-none">
          {pending ? "Checking…" : "Redeem"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.success && <p className="text-sm text-ok">{state.success}</p>}
    </form>
  );
}

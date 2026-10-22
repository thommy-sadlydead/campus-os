"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { resetPasswordAction, type ResetPasswordState } from "@/app/forgot-password/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/account-forms";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/password-reset";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary btn-lg mt-1 w-full">
      {pending ? "Saving…" : "Save new password"}
    </button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(resetPasswordAction.bind(null, token), undefined);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {(["newPassword", "confirmPassword"] as const).map((id) => (
        <div key={id} className="flex flex-col">
          <label htmlFor={id} className="field-label">
            {id === "newPassword" ? "New password" : "Confirm new password"}
          </label>
          <input
            id={id}
            name={id}
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder="••••••••"
            className="field"
          />
        </div>
      ))}
      <p className="text-xs text-ink-faint">
        At least {MIN_PASSWORD_LENGTH} characters. Saving signs you out on your other devices.
      </p>
      {state?.error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
          {state.error === RESET_LINK_INVALID_MESSAGE && (
            <>
              {" "}
              <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                Send a new link
              </Link>
            </>
          )}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}

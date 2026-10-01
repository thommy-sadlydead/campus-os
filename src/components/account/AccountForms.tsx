"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, deleteAccountAction, type AccountActionState } from "@/app/account/actions";
import { DELETE_CONFIRMATION_WORD, MIN_PASSWORD_LENGTH } from "@/lib/account-forms";

const INPUT_CLASS = "field";

function Field({
  id,
  label,
  ...inputProps
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input id={id} name={id} className={INPUT_CLASS} {...inputProps} />
    </div>
  );
}

function SubmitButton({ label, pendingLabel, danger }: { label: string; pendingLabel: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`btn mt-1 self-start ${danger ? "btn-destructive" : "btn-primary"}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Message({ state }: { state: AccountActionState }) {
  if (state?.error) return <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>;
  if (state?.success) return <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{state.success}</p>;
  return null;
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AccountActionState, FormData>(changePasswordAction, undefined);
  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <Field id="currentPassword" label="Current password" type="password" required autoComplete="current-password" />
      <Field
        id="newPassword"
        label="New password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <Field
        id="confirmPassword"
        label="Confirm new password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <Message state={state} />
      <SubmitButton label="Change password" pendingLabel="Saving…" />
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, formAction] = useActionState<AccountActionState, FormData>(deleteAccountAction, undefined);
  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <Field id="password" label="Your password" type="password" required autoComplete="current-password" />
      <Field
        id="confirmation"
        label={`Type ${DELETE_CONFIRMATION_WORD} to confirm`}
        type="text"
        required
        autoComplete="off"
        pattern={DELETE_CONFIRMATION_WORD}
      />
      <Message state={state} />
      <SubmitButton label="Delete my account" pendingLabel="Deleting…" danger />
    </form>
  );
}

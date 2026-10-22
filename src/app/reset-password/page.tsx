import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/ui/AuthCard";
import { resetLinkIsUsable } from "@/lib/password-reset-server";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/password-reset";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Reset password · Campus OS" };

// Where the link in a reset email lands. Checking the link here only reads
// it; it's used up when the new password is saved.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token?.trim() ?? "";
  const usable = await resetLinkIsUsable(token);

  return (
    <AuthCard title={usable ? "Choose a new password" : "Link expired"}>
      {usable ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-center text-sm leading-relaxed text-ink-soft">{RESET_LINK_INVALID_MESSAGE}</p>
          <Link href="/forgot-password" className="btn btn-primary btn-lg w-full">
            Send a new link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}

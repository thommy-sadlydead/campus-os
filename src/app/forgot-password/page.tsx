import type { Metadata } from "next";
import { AuthCard } from "@/components/ui/AuthCard";
import { passwordResetAvailable } from "@/lib/password-reset-server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Forgot password · Campus OS" };

// Reset emails need RESEND_API_KEY, EMAIL_FROM and APP_URL (see
// src/lib/email-send.ts). Until they're set, this points to support.
export default async function ForgotPasswordPage() {
  const available = await passwordResetAvailable();
  const contactEmail = process.env.CONTACT_EMAIL?.trim();

  return (
    <AuthCard
      title="Forgot your password?"
      description={available ? "Enter the email you signed up with and we'll send you a link to choose a new one." : undefined}
    >
      {available ? (
        <ForgotPasswordForm />
      ) : (
        <p className="mt-4 text-center text-sm leading-relaxed text-ink-soft">
          {contactEmail ? (
            <>
              Email{" "}
              <a href={`mailto:${contactEmail}`} className="font-medium text-ink underline underline-offset-2">
                {contactEmail}
              </a>{" "}
              from the address you signed up with, and we&apos;ll help you get back in.
            </>
          ) : (
            "Contact Campus OS support from the address you signed up with, and we'll help you get back in."
          )}
        </p>
      )}
    </AuthCard>
  );
}

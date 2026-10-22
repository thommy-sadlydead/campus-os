import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { BrandBackdrop } from "@/components/ui/BrandBackdrop";

// The centered card the login screen uses, for the pages around it
// (forgot password, reset password).
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <BrandBackdrop />
      <div className="relative w-full max-w-sm">
        <Link href="/" aria-label="Campus OS home" className="mx-auto mb-6 flex w-fit">
          <LogoMark size={44} />
        </Link>
        <div className="card p-6 shadow-pop sm:p-8">
          <h1 className="text-center font-display text-2xl font-semibold">{title}</h1>
          {description && <p className="mb-6 mt-1.5 text-center text-sm text-ink-soft">{description}</p>}
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-ink-faint">
          <Link href="/login" className="hover:text-ink hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}

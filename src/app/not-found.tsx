import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { BrandBackdrop } from "@/components/ui/BrandBackdrop";

// Shown for any address that doesn't exist, and for a class that isn't
// yours (the class page calls notFound()).
export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <BrandBackdrop />
      <main className="relative flex max-w-sm flex-col items-center text-center">
        <LogoMark size={44} />
        <p className="eyebrow mt-6">404</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">The link may be old, or the page may have been removed.</p>
        <Link href="/dashboard" className="btn btn-primary btn-lg mt-6">
          Go to your dashboard
        </Link>
      </main>
    </div>
  );
}

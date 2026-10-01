import type { Metadata } from "next";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = { title: "Offline · Campus OS" };

// Precached by public/sw.js and shown when a page is opened without a
// connection. Static on purpose: it has to render with nothing but itself.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <main className="flex max-w-sm flex-col items-center text-center">
        <LogoMark size={44} />
        <h1 className="mt-6 font-display text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Campus OS needs an internet connection. Check your Wi-Fi or data, then try again.
        </p>
        <a
          href="/dashboard"
          className="btn btn-primary btn-lg mt-6"
        >
          Try again
        </a>
      </main>
    </div>
  );
}

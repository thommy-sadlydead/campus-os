import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · Campus OS" };

// Precached by public/sw.js and shown when a page is opened without a
// connection. Static on purpose: it has to render with nothing but itself.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <main className="max-w-sm text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Campus OS</div>
        <h1 className="mt-2 font-display text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Campus OS needs an internet connection. Check your Wi-Fi or data, then try again.
        </p>
        <a
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-surface hover:opacity-90"
        >
          Try again
        </a>
      </main>
    </div>
  );
}

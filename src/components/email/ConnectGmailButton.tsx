"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthSession, hasNativePlugin, nativeErrorCode } from "@/lib/native-app";

/**
 * "Connect Gmail". On the website it's a plain link into Google's sign-in.
 * In the iPhone app Google won't sign in inside the app's web view, so it
 * opens the system sign-in sheet instead (see src/lib/native-oauth.ts).
 */
export function ConnectGmailButton({ className }: { className: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectInApp(event: React.MouseEvent) {
    if (!hasNativePlugin("AuthSession")) return; // the link does it
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await fetch("/api/email/oauth/native-link", { method: "POST" });
      if (!link.ok) throw new Error("Couldn't start connecting Gmail. Try again.");
      const { url } = (await link.json()) as { url: string };

      let finishedAt: URL;
      try {
        finishedAt = new URL((await AuthSession.start({ url, callbackScheme: "campusos" })).url);
      } catch (err) {
        if (nativeErrorCode(err) === "cancelled") return;
        throw new Error("Google's sign-in didn't finish. Try again.");
      }

      const failure = finishedAt.searchParams.get("error");
      const result = finishedAt.searchParams.get("result");
      if (failure || !result) throw new Error(failure ?? "Google's sign-in didn't finish. Try again.");

      const finish = await fetch("/api/email/oauth/native-finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!finish.ok) {
        const body = (await finish.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't save the Gmail connection. Try again.");
      }
      router.replace("/email?connected=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect Gmail. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 flex flex-col items-start gap-2">
      <a
        href="/api/email/oauth/start"
        onClick={(event) => void connectInApp(event)}
        aria-disabled={busy}
        className={`${className} ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        {busy ? "Connecting…" : "Connect Gmail"}
      </a>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

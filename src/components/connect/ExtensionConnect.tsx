"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExtensionPairingAction } from "@/app/connect/extension-actions";
import { CheckIcon, ExternalIcon, RefreshIcon } from "@/components/icons";

// Setting up the Campus OS Chrome extension from a Connect page, and
// starting a sync from here once it's set up. The page and the extension
// talk through the extension's bridge script (chrome-extension/src/
// app-bridge.js) with window.postMessage, this page's own origin only.

interface BridgeSite {
  origin: string;
  provider: string;
  lastSyncAt: string | null;
  running: boolean;
  lastResult?: { ok: boolean; error?: string } | null;
}

interface BridgeStatus {
  installed: boolean;
  paired?: boolean;
  email?: string | null;
  sites?: BridgeSite[];
}

const post = (message: Record<string, unknown>) => window.postMessage({ source: "campus-os-app", ...message }, window.location.origin);

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-semibold ring-1 ${
          done ? "bg-ok-soft text-ok ring-transparent" : "bg-surface-2 text-ink-soft ring-border-soft"
        }`}
      >
        {done ? <CheckIcon className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>}
      </div>
    </li>
  );
}

export function ExtensionConnect({
  provider,
  providerName,
  installUrl,
  accountEmail,
  connected,
}: {
  provider: "brightspace" | "blackboard";
  providerName: string;
  /** The Chrome Web Store page (CHROME_EXTENSION_URL), once published. */
  installUrl: string | null;
  accountEmail: string;
  /** Campus OS already has this LMS through the extension. */
  connected: boolean;
}) {
  const router = useRouter();
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "campus-os-extension") return;
      if (data.type === "status") setBridge({ installed: true, paired: data.paired, email: data.email, sites: data.sites ?? [] });
      if (data.type === "paired") {
        setBusy(false);
        setMessage({ text: `The extension is connected to ${data.email}.`, error: false });
      }
      if (data.type === "pair-failed") {
        setBusy(false);
        setMessage({ text: data.error ?? "Couldn't connect the extension.", error: true });
      }
      if (data.type === "sync-result") {
        setBusy(false);
        if (data.error === "notSetUp") {
          setMessage({ text: `Open ${providerName} and click the Campus OS button there to choose your courses first.`, error: true });
        } else if (data.error) {
          setMessage({ text: data.error, error: true });
        } else {
          setMessage({ text: "Syncing. This page shows each course as it comes in.", error: false });
          router.refresh();
        }
      }
    }
    window.addEventListener("message", onMessage);
    post({ type: "hello" });
    const timer = setTimeout(() => setBridge((b) => b ?? { installed: Boolean(document.documentElement.dataset.campusOsExtension) }), 1500);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [providerName, router]);

  const site = bridge?.sites?.find((s) => s.provider === provider) ?? null;
  const pairedHere = Boolean(bridge?.paired && bridge.email?.toLowerCase() === accountEmail.toLowerCase());

  // The first import starts in the extension; once Campus OS has it, show it here.
  const waitForFirstImport = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
      post({ type: "hello" });
    }, 4000);
  }, [router]);
  useEffect(() => {
    if (site && !connected) waitForFirstImport();
  }, [site, connected, waitForFirstImport, bridge]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  async function connect() {
    setBusy(true);
    setMessage(null);
    const result = await createExtensionPairingAction();
    if (!result.code) {
      setBusy(false);
      setMessage({ text: result.error ?? "Couldn't start connecting. Try again.", error: true });
      return;
    }
    post({ type: "pair", code: result.code });
  }

  function syncNow() {
    setBusy(true);
    setMessage(null);
    post({ type: "sync", provider });
  }

  if (bridge === null) return <p className="text-sm text-ink-faint">Checking for the Campus OS extension…</p>;

  if (connected && pairedHere && site) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={syncNow} disabled={busy || site.running} className="btn btn-primary btn-sm">
            <RefreshIcon className="h-3.5 w-3.5" />
            {site.running ? "Syncing…" : "Sync now"}
          </button>
          <span className="text-[13px] text-ink-soft">Uses your {providerName} sign-in in this browser.</span>
        </div>
        {message && <p className={`text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {connected && (
        <p className="text-sm text-ink-soft">
          {providerName} syncs from a browser with the Campus OS extension. To sync from this one, set it up here:
        </p>
      )}
      <ol className="flex flex-col gap-4">
        <Step n={1} done={bridge.installed} title="Add the Campus OS extension to Chrome">
          {!bridge.installed && (
            <>
              <p>It works in Chrome on a computer (and in Edge and Brave). Installed it already? Reload this page.</p>
              {installUrl ? (
                <a href={installUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-2">
                  Add to Chrome
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="mt-1 text-[13px] text-ink-faint">The extension is on its way to the Chrome Web Store. Until then, use your calendar link below.</p>
              )}
            </>
          )}
        </Step>
        <Step n={2} done={pairedHere} title="Connect it to your Campus OS account">
          {bridge.installed && !pairedHere && (
            <>
              {bridge.paired && bridge.email && (
                <p>
                  It&apos;s connected to {bridge.email} right now. Connect it to {accountEmail} instead?
                </p>
              )}
              <button type="button" onClick={connect} disabled={busy} className="btn btn-primary btn-sm mt-2">
                {busy ? "Connecting…" : "Connect the extension"}
              </button>
            </>
          )}
        </Step>
        <Step n={3} done={Boolean(site)} title={`Choose your ${providerName} courses`}>
          {pairedHere && !site && (
            <p>
              Open your school&apos;s {providerName} in Chrome and sign in as usual. Click the Campus OS button in the toolbar (under the
              puzzle-piece icon if it&apos;s hidden), allow the site, and check the courses to import.
            </p>
          )}
          {site && !connected && <p>Importing from {new URL(site.origin).host}… This page updates when it&apos;s in.</p>}
        </Step>
      </ol>
      {message && <p className={`text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>{message.text}</p>}
      <p className="text-xs leading-relaxed text-ink-faint">
        The extension reads {providerName} with the sign-in you already have in this browser: only courses and files your account can
        open, only after you choose them. It never sees your school password, and Campus OS never stores your {providerName} sign-in.
      </p>
    </div>
  );
}

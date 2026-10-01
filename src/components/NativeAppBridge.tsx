"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { hasNativePlugin, isNativeApp, NativeRecorder, SharedInbox } from "@/lib/native-app";

const AUTO_OPENED_KEY = "campusos-auto-opened";
/** Back in the app this soon after sharing a recording, go straight to it. */
const FRESH_SHARE_MS = 3 * 60 * 1000;

/**
 * In the iPhone app only: notices recordings shared from Voice Memos and
 * where notification taps should go. A recording shared a moment ago opens
 * the Record page; older ones get a banner on every page until they're
 * added or deleted. A recording still going after the student left the
 * Record page gets a bar that leads back to it. Renders nothing on the
 * website.
 */
export function NativeAppBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    const tap = LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
      const route = (notification.extra as { route?: unknown } | undefined)?.route;
      if (typeof route === "string" && route.startsWith("/")) router.push(route);
    });
    return () => void tap.then((handle) => handle.remove());
  }, [router]);

  useEffect(() => {
    if (!hasNativePlugin("SharedInbox")) return;
    const check = async () => {
      const { items } = await SharedInbox.list();
      setWaiting(items.length);
      const fresh = items.find((i) => i.source === "share" && Date.now() - new Date(i.addedAt).getTime() < FRESH_SHARE_MS);
      if (!fresh || pathname === "/record") return;
      let opened: string[] = [];
      try {
        opened = JSON.parse(sessionStorage.getItem(AUTO_OPENED_KEY) ?? "[]") as string[];
      } catch {
        // storage unavailable; worst case it opens twice
      }
      if (opened.includes(fresh.id)) return;
      try {
        sessionStorage.setItem(AUTO_OPENED_KEY, JSON.stringify([...opened, fresh.id]));
      } catch {
        // as above
      }
      router.push("/record");
    };
    const checkRecording = async () => {
      if (!hasNativePlugin("NativeRecorder")) return;
      const { state } = await NativeRecorder.status();
      setRecording(state === "recording" || state === "paused");
    };
    void check();
    void checkRecording();
    const resume = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void check();
        void checkRecording();
      }
    });
    return () => void resume.then((handle) => handle.remove());
  }, [pathname, router]);

  if (pathname === "/record") return null;
  if (recording) {
    return (
      <Link
        href="/record"
        className="flex items-center justify-center gap-2 bg-danger px-4 py-2.5 text-sm font-semibold text-white"
      >
        <span aria-hidden className="block h-2 w-2 animate-pulse rounded-full bg-white" />
        Recording a lecture. Tap to return.
      </Link>
    );
  }
  if (waiting === 0) return null;
  return (
    <Link
      href="/record"
      className="block border-b border-border-soft bg-accent-soft px-4 py-2.5 text-center text-sm font-medium text-accent-ink"
    >
      {waiting === 1 ? "1 recording is" : `${waiting} recordings are`} waiting to be added to a class →
    </Link>
  );
}

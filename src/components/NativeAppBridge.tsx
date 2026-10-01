"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { hasNativePlugin, isNativeApp, NativeRecorder, SharedInbox } from "@/lib/native-app";
import { ChevronRightIcon, MicIcon } from "@/components/icons";

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
        className="mb-5 flex items-center gap-3 rounded-xl2 bg-danger-soft px-4 py-3 text-sm text-danger"
      >
        <span className="relative flex h-2.5 w-2.5 flex-none">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-danger opacity-60" />
          <span aria-hidden className="relative h-2.5 w-2.5 rounded-full bg-danger" />
        </span>
        <span className="flex-1 font-semibold">Recording a lecture</span>
        <span className="flex items-center gap-1 text-[13px] font-medium">
          Return
          <ChevronRightIcon className="h-4 w-4" />
        </span>
      </Link>
    );
  }
  if (waiting === 0) return null;
  return (
    <Link
      href="/record"
      className="mb-5 flex items-center gap-3 rounded-xl2 bg-accent-soft px-4 py-3 text-sm text-accent-ink"
    >
      <MicIcon className="h-[18px] w-[18px] flex-none" />
      <span className="flex-1 font-medium">
        {waiting === 1 ? "1 recording is" : `${waiting} recordings are`} waiting to be added to a class
      </span>
      <ChevronRightIcon className="h-4 w-4 flex-none" />
    </Link>
  );
}

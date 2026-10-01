"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { hasNativePlugin, isNativeApp, SharedInbox } from "@/lib/native-app";

const AUTO_OPENED_KEY = "campusos-auto-opened";
/** Back in the app this soon after sharing a recording, go straight to it. */
const FRESH_SHARE_MS = 3 * 60 * 1000;

/**
 * In the iPhone app only: notices recordings shared from Voice Memos and
 * where notification taps should go. A recording shared a moment ago opens
 * the Record page; older ones get a banner on every page until they're
 * added or deleted. Renders nothing on the website.
 */
export function NativeAppBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);

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
    void check();
    const resume = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void check();
    });
    return () => void resume.then((handle) => handle.remove());
  }, [pathname, router]);

  if (waiting === 0 || pathname === "/record") return null;
  return (
    <Link
      href="/record"
      className="block border-b border-border-soft bg-accent-soft px-4 py-2.5 text-center text-sm font-medium text-accent-ink"
    >
      {waiting === 1 ? "1 recording is" : `${waiting} recordings are`} waiting to be added to a class →
    </Link>
  );
}

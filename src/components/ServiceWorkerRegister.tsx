"use client";

import { useEffect } from "react";

// Registers public/sw.js in production only, so `npm run dev` never serves
// a stale cached build while you're actively editing. Ported from
// Voicewrite's own ServiceWorkerRegister.tsx (identical app-agnostic logic).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  }, []);

  return null;
}

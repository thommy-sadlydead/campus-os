"use client";

import { useEffect } from "react";

/** Opens the <details> a link's #hash names (SettingsRow), since browsers only scroll to it. */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const el = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}

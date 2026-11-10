"use client";

import { createContext, useContext } from "react";
import Link from "next/link";

// A link in the app's own navigation (sidebar, top bar, tab bar). The frame
// (src/components/ShellChrome.tsx) shows placeholders the moment one is
// tapped, so the tap answers at once while the next page renders.
//
// These don't prefetch. With no loading.tsx a prefetch renders the whole page
// on the server, about six per page view, which helped run the database out
// of connections on Nov 5, 2026. Pages can't have a loading.tsx either: with
// one, Next.js 15 left a page stuck after a save (the form's transition
// never finished, so what was saved didn't show) until the next navigation
// (Nov 9, 2026).

export const NavStartContext = createContext<(href: string) => void>(() => {});

export function ShellLink({ href, onNavigate, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const startNav = useContext(NavStartContext);
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onNavigate={(e) => {
        onNavigate?.(e);
        startNav(href);
      }}
    />
  );
}

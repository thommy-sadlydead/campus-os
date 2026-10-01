import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600", "700"],
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Campus OS",
  description: "Your entire academic life, in one place.",
  applicationName: "Campus OS",
  // Standalone launch (no Safari chrome) when opened from the iOS home
  // screen icon - manifest.ts alone only covers the Android/desktop install
  // prompt, iOS needs these apple-specific tags too.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Campus OS",
  },
};

// Tints the mobile browser chrome (and iOS status bar area) to match the
// app's own light/dark surface color instead of the browser's default.
export const viewport: Viewport = {
  // Lets the page use the whole iPhone screen in the installed app (the
  // status bar is translucent, above). The header and the bottom tab bar
  // pad themselves with env(safe-area-inset-*) to stay clear of the notch
  // and the home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1f29" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

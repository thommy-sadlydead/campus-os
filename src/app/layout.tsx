import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

// Inter for everything. Its optical-size axis gives headings and big numbers
// the Display cut automatically; timers use its tabular digits.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", axes: ["opsz"] });

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
    { media: "(prefers-color-scheme: light)", color: "#f2f2f0" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} font-sans antialiased`}
      >
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

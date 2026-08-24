import type { MetadataRoute } from "next";

// Makes Campus OS installable as a PWA (Android "Install app" prompt / iOS
// "Add to Home Screen"). start_url is "/" so the icon always opens through
// the existing root redirect (-> /dashboard if signed in, -> /login if not)
// rather than hardcoding a route that could break auth.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Campus OS",
    short_name: "Campus OS",
    description: "Your entire academic life, in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#14161d",
    theme_color: "#1c1f29",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

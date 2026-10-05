// Baseline security headers on every response. There's deliberately no
// script-src/style-src Content-Security-Policy: Next.js inlines scripts for
// hydration, which a strict CSP would only allow with per-request nonces
// (middleware). What's here blocks other sites from framing the app
// (clickjacking), MIME sniffing, and cross-site referrer leaks, and turns
// off browser features the app never uses. HSTS is left to Vercel, which
// already sends it.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone is allowed for this site only, for recording lectures
  // (src/components/lectures/LectureRecorder.tsx).
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb',
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Voicewrite was removed; old bookmarks land on the dashboard instead of a 404.
  // The Canvas page moved under Connect when more LMSs were added.
  async redirects() {
    return [
      { source: "/voicewrite", destination: "/dashboard", permanent: false },
      { source: "/canvas", destination: "/connect/canvas", permanent: false },
    ];
  },
};

export default nextConfig;

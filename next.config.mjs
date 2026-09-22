/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb',
    },
    // @napi-rs/canvas (used by unpdf's renderPageAsImage, for OCR-ing
    // scanned PDFs — see src/lib/pdf-ocr.ts) ships a native .node binary.
    // Webpack can't parse that as JS, so it has to be excluded from
    // bundling and required directly at runtime instead.
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
  },
};

export default nextConfig;

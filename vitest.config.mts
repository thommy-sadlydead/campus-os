import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // Next.js's bundler swaps the real "server-only" package for a no-op
      // when compiling server code, and only lets it throw if pulled into
      // a Client Component bundle by mistake. Vitest has no such
      // distinction, and every test here exercises server-side logic, so
      // this mirrors that same no-op — see tests/mocks/server-only.ts.
      "server-only": path.resolve(dirname, "./tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "node",
  },
});

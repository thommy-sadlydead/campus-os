// Stand-in for the "server-only" package under Vitest. Next.js's own
// bundler swaps that package for a no-op when compiling genuine server
// code (it only throws when accidentally pulled into a Client Component
// bundle) — Vitest has no such build-time distinction, and every test here
// exercises server-side logic, so this alias (see vitest.config.mts)
// reproduces the same no-op behavior instead of the package's unconditional
// throw.
export {};

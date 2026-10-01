# Campus OS — working notes for Claude Code

Personal academic organizer for Reece Broderick (Cedarville University,
`reecebroderick@cedarville.edu`). Deployed at
`https://campus-os-mocha-pi.vercel.app`. Repo: `thommy-sadlydead/campus-os`.

**Start with [README.md](README.md)** for the full feature narrative,
setup steps, and data architecture — it's kept current and is the real
spec/changelog. This file is the shorter, denser complement: conventions,
operational gotchas, and things that aren't obvious just from reading the
code.

## Critical: this is a live production database

There is **no dev/prod split**. `DATABASE_URL` (Prisma Postgres) points at
the *same* real database Reece's deployed app uses, whether you're running
`npm run dev` locally or not. There are no `prisma/migrations/` — schema
changes go out via `npx prisma db push`, and **`npm run build` runs
`prisma db push --skip-generate && next build`**, so a normal build applies
pending schema changes to production automatically. Real users exist in
this database today (`reecebroderick@cedarville.edu` is the primary one,
plus a few others) with real Canvas-synced data. Treat any schema change or
data-touching script accordingly — verify against a throwaway class/record
when possible, not by mutating a real user's rows directly, and always run
`npx prisma validate` before `db push`.

If a `db push` reports a possible data-loss warning, don't reflexively add
`--accept-data-loss` — check what it actually means first (e.g. a new
nullable column can never lose data even though Prisma warns generically
about any new unique constraint).

## Tech stack

Next.js 15.5.27 (App Router, Server Actions), React 19, Prisma 5.22 +
PostgreSQL, Zod, Tailwind (no typography plugin — manual `[&_x]:`
child-selector utilities in `src/lib/markdown.ts`'s `MARKDOWN_CLASSNAME`),
Vitest (`environment: "node"`). `@anthropic-ai/sdk@0.32.1` — notably old
(latest is 0.128.x); works fine for everything currently used, but its
types predate some newer API features (see `src/lib/pdf-ocr.ts`'s
`PdfDocumentBlockParam` workaround). Auth is homegrown email/password +
session cookies, no third-party auth.

## Conventions worth matching

- **String fields, not Prisma enums**, everywhere a fixed set of values is
  needed (`Assignment.status`, `Email.category`, `ClassMaterial.syncStatus`,
  etc.) — a SQLite-era decision (enums aren't supported there) that's kept
  for consistency even though the app is Postgres now. Each field's valid
  values are documented in a comment above the model in
  `prisma/schema.prisma`, and mirrored as a TS union type in the relevant
  `src/lib/*.ts` file — always add both when introducing a new status value.
- **Minimal dependencies, hand-roll small things.** PDF/OOXML/EPUB parsing
  uses `unpdf`/`jszip`/regex extraction instead of full parser libraries;
  bounded-concurrency work uses a ~15-line hand-rolled worker pool
  (`mapWithConcurrency` in `canvas-materials-sync.ts`), not a new `p-limit`
  dependency. Ask "does the codebase already do something like this?"
  before reaching for a new package.
- **Server Actions catch their own errors and return `{error: string} |
  undefined`** instead of throwing, wherever the error message needs to
  reach the user — Next.js redacts thrown Server Action error messages in
  production (this is only reproducible under `next start`, never `next
  dev`, which cost real debugging time to find once already).
- **React 19 resets a `<form action={…}>` after its action finishes, even
  when the action returns an error.** Uncontrolled inputs go back to their
  `defaultValue`, so an action that fails validation should echo back what
  the user typed (see `AuthActionState.email` in `src/app/login/actions.ts`
  and `ConnectCanvasState.baseUrl`) and the form should use it as
  `defaultValue`. Forms driven by `onSubmit` + `useState` aren't affected.
- **Anything that costs money per call goes through `src/lib/rate-limit.ts`**
  (AI requests, new lectures, audio upload tokens), and failed password
  checks count toward the login limit. The limits are Postgres rows, not
  memory, because serverless instances don't share memory.
- **The service worker (`public/sw.js`) caches static files only.** Never
  let it answer Next.js page-data (RSC) requests or pages: v1 did, and
  `router.refresh()` kept showing the previous copy after every change.
  Bump `CACHE_VERSION` whenever what it caches changes.
- **Don't call `history.replaceState`/`pushState` to sync UI state (like the
  class page's tab) into the URL.** Next.js treats it as a navigation, and a
  navigation discards any refresh still in flight, so the page shows stale
  data. `?tab=` on the class page is read once, for links into a tab.
- **A server component can't call a function or read a value exported
  from a `"use client"` file** (it gets a client reference, and calling it
  throws at render). Shared helpers used on both sides go in a plain module:
  see `src/components/classes/class-tabs.ts` and
  `src/components/assignments/assignment-grid.ts`.
- **Phones get a bottom tab bar** (`src/components/MobileNav.tsx`, below
  `lg`); the top menu in `AppShell` is for wide screens. The viewport uses
  `viewport-fit=cover`, so anything fixed to the top or bottom pads itself
  with `env(safe-area-inset-*)`, and floating UI near the bottom (toasts)
  sits above the tab bar on phones.
- **Requests to the app are capped at 4.5 MB on Vercel**, whatever
  `serverActions.bodySizeLimit` says. Anything bigger (lecture audio, large
  book/slide files) goes browser → Blob with a client token, then a Server
  Action reads it from Blob.
- **Client-side "is this done yet?" polling is a self-scheduling
  `setTimeout` loop, never `setInterval`.** `setInterval` can fire the next
  poll before the previous one's request resolves, stacking up concurrent
  work for the same job. See `LecturesPanel.tsx` and
  `MaterialSyncPanel.tsx` for the established pattern — wait for one poll's
  action to fully resolve, then schedule the next.
- **Long-running work is a bounded status machine + client polling, not a
  background job queue.** There's no Redis/queue/cron in this app. Both the
  `Lecture` model (`UPLOADED → TRANSCRIBING → GENERATING_NOTES →
  READY/FAILED`) and `CanvasSyncCourseState`
  (`PENDING → DISCOVERING → DOWNLOADING → READY/PARTIAL/FAILED`) follow
  this shape: a server action advances the state by one small bounded chunk
  and returns immediately; the client re-invokes it on an interval until
  every tracked item reaches a terminal state. Lectures also advance
  without a page open: AssemblyAI's webhook (production only) and
  `after()` from `next/server`, which runs note generation after the
  response instead of holding a request open for minutes.
- **Secrets encrypted at rest with one shared helper**
  (`src/lib/crypto.ts`, AES-256-GCM, key derived from `AUTH_SECRET`) — used
  for `CanvasAccount.accessTokenEnc` and `EmailAccount.accessTokenEnc`/
  `refreshTokenEnc`. Reuse this rather than adding a second encryption
  scheme. Note: `crypto.ts` (and anything that imports it, e.g.
  `canvas-materials-sync.ts` via `pdf-ocr.ts` → `anthropic.ts`) has
  `import "server-only"`, so a standalone script run via plain `node`/`tsx`
  can't import it directly — see "Verifying against real data" below.
- **AI-backed features degrade gracefully, never block on AI being
  unavailable.** `askClaude`/`askClaudeForJson` (`src/lib/anthropic.ts`)
  return `null` on any failure and every caller has a deterministic
  fallback. The exception is features where AI generation *is* the feature
  with no reasonable fallback (lecture note generation, OCR) — those call
  the SDK directly and surface a real `FAILED` status with a real error
  message instead of silently returning nothing.

## Key files by area

- **Canvas**: `canvas.ts` (REST client: pagination via `Link` header,
  retry/backoff on 429/5xx, never on 401/403/404) → `canvas-sync.ts`
  (course/assignment sync, shared by the in-app action and
  `scripts/sync-canvas.ts`) and `canvas-materials.ts` +
  `canvas-materials-sync.ts` (materials discovery/dedup/incremental sync
  across Files/Modules/Pages/Assignments/Syllabus — the bulk of the recent
  work; see its own extensive module comments).
- **Documents**: `office-text.ts` (PDF/PPTX/DOCX/EPUB text extraction) →
  `pdf-ocr.ts` (fallback when a PDF has no text layer — sends the whole PDF
  to Claude as a native `document` content block; **do not** reintroduce
  per-page image rendering, see Known limitations below for why).
- **Lectures**: `lecture-notes.ts` (pure prompt-building/formatting logic)
  + `lecture-pipeline.ts` (submit to AssemblyAI, `advanceLecture`, note
  generation; shared by the Server Actions and the AssemblyAI webhook at
  `/api/lecture-audio/transcribed`) + `src/app/classes/[id]/lecture-actions.ts`
  (the Server Actions for the Lectures tab) + `lecture-notes-sync.ts` (each
  lecture's notes as a linked Note in the Notes tab). Recording and upload
  UI is in `src/components/lectures/`; `record-class.ts` picks the class
  from the schedule for `/record`.
  - Never put pipeline helpers in `lecture-actions.ts`: every export of a
    `"use server"` file is a public endpoint that anyone can call with any
    arguments, and `generateNotes` does no ownership check.
  - Each step is claimed with a conditional `updateMany` (status in the
    `where`), because the webhook and the page's polling can both try to
    move the same lecture at once. Only the claimer writes the notes.
- **Priority/workload**: `priority-engine.ts`, `workload.ts`,
  `risk-engine.ts`, `breakdown-heuristics.ts` — all pure, dependency-free,
  heavily unit-tested; this is the oldest and most stable part of the app.
- **Email intelligence**: `gmail.ts`, `google-oauth.ts`,
  `email-classify-heuristic.ts`, `email-intelligence.ts`,
  `change-rules.ts` + `pending-changes.ts` (the only code path allowed to
  write an email-derived fact into Class/Assignment/Exam/ScheduleEvent).

## Verifying a change before calling it done

1. `npx tsc --noEmit` (after `npx prisma generate` if the schema changed)
2. `npx vitest run` — 221 tests as of this writing across 17 files
3. Clean build: `rm -rf .next && npx next build` (use `next build` directly
   to skip the `db push` the `npm run build` script triggers, if you're not
   ready to push schema changes yet)
4. If it touches Canvas/AI/anything not exercisable by tests alone: verify
   against real data (see below), not just "tests pass."
5. Commit, push, then poll GitHub's commit-status API for the Vercel
   deployment result — **never guess the Vercel URL**:
   ```bash
   SHA=$(git rev-parse HEAD)
   curl -s "https://api.github.com/repos/thommy-sadlydead/campus-os/commits/$SHA/status"
   ```
6. Live-check the deployed URL once the status is `success`.

### Verifying against real data

Several `src/lib/*.ts` modules (`crypto.ts`, and transitively
`canvas-materials-sync.ts` via `pdf-ocr.ts`) have `import "server-only"`,
which throws unconditionally outside Next.js's server-component compiler —
a plain `npx tsx some-script.ts` importing them will crash immediately.
Two known-good workarounds, both used this session:
- For `vitest`, alias `server-only` to a no-op module (see
  `vitest.config.mts` + `tests/mocks/server-only.ts`) — this is already
  set up, so tests importing these modules work normally.
- For a one-off standalone script (e.g. to run the Canvas sync engine
  directly against real data without going through the browser), the
  functions in `canvas-materials-sync.ts` (`queueCourseMaterialSync`,
  `advanceCanvasMaterialSync`, `processCourseChunk`,
  `discoverCourseResources`) all take a `PrismaClient` + `CanvasConfig` as
  plain arguments and don't need the Next.js request context — you just
  need the `server-only` import itself to not throw for the duration of
  the script. Temporarily swap `node_modules/server-only/index.js`'s
  content for `module.exports = {};`, run the script, then restore the
  original content (back it up first). This is safe because
  `node_modules` isn't committed and the swap is trivially reversible.

## Known limitations (not bugs — don't "fix" without new information)

- A file/page/syllabus resource with no reliable Canvas-side `updated_at`
  (an external link, a syllabus, a file only discoverable via
  Modules/Pages rather than the Files endpoint) can't be detected as
  "changed" on a later sync — it just won't auto-refresh if edited.
- Scanned PDFs are OCR'd by sending the whole file to Claude as a
  `document` content block (see `pdf-ocr.ts`). An earlier version rendered
  each page as an image locally (`unpdf`'s `renderPageAsImage` +
  `@napi-rs/canvas`) — **don't reintroduce that approach**: real scanned
  course PDFs use JBIG2 image compression that PDF.js's decoder can't
  initialize, so every rendered page came back blank. The current
  document-block approach fixed most of these (confirmed against real
  files), but a small number still fail with Anthropic's own
  content-filtering policy on the output — that's a model-level decision,
  not a bug to route around; the user's fallback is pasting the text in
  directly (already an existing feature).
- Legacy binary `.ppt`/`.doc` (pre-2007 OLE format) are recorded but not
  imported — no parser for that format in this codebase.
- No scheduled/background sync — materials sync is triggered by connecting
  Canvas or clicking "Go fetch materials," never on a timer.

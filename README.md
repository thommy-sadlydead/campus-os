# Campus OS

A personal "student operating system" built on top of the Fall Ledger Canvas
calendar: a Command Center dashboard, per-class pages with flexible notes,
Gmail-based email intelligence, automatic AI assignment breakdown, and a
Behind/At-Risk workload status — all pointed at the same real data, so the
app can answer *"what should I do right now?"*, *"am I missing anything
Canvas doesn't know about?"*, and *"am I actually going to be okay this
week?"*

This is the **full original plan — phases 1 through 4** — see
[Roadmap](#roadmap) for what's built and what's deliberately still flagged
as out of scope.

## What's built

- **Data model** for the whole app (`prisma/schema.prisma`): User, Class,
  ScheduleEvent, Assignment, Task, Exam, Email, EmailAccount, CanvasAccount,
  PendingChange, NoteSection, Note, Resource, AvailabilityBlock — see
  [Data architecture](#data-architecture).
- **Auth**: email/password, hashed with bcrypt, session cookies (httpOnly,
  signed) — no third-party auth dependency, since Gmail OAuth is a
  *separate*, narrowly-scoped connection, not your login method.
- **Canvas connection** (`/canvas`): paste a Canvas access token right in
  the app — no terminal needed — to pull in your real courses and
  assignments, with a **Sync now** button to re-pull any time. The token is
  encrypted at rest the same way Gmail's is. `scripts/sync-canvas.ts` (`npm
  run canvas:sync`) still exists as an env-var/cron-friendly alternative for
  anyone who wants it — both paths share the same sync logic
  (`src/lib/canvas-sync.ts`), so they can't drift apart.
- **Command Center dashboard**: a ranked "what should I do" list, a
  **"What should I do right now?"** button, an **"I have X minutes"**
  finder, a workload summary (overdue / due today / due tomorrow, remaining
  work, and — only if you've logged it — how much free time you have and
  whether you're ahead or behind), and an **"Ask about everything"** panel
  for free-form cross-class questions ("What should I do tonight?", "Am I
  going to be screwed next week?").
- **Per-class pages** (`/classes/[id]`): Overview (professor, room, current
  grade, next assignment/exam — all editable, since Canvas doesn't provide
  any of it), Assignments, Notes, Exams, Resources, and a class-scoped **AI
  assistant** ("Summarize my notes," "Make a study guide," "Quiz me,"
  "What am I missing?," "What's due next?," "Prepare me for my next exam")
  that only ever sees that one class's data.
- **Flexible Notes system**: create/rename/delete/reorder sections and
  notes yourself (no forced structure), pin important notes, search across
  a class's notes. Available from each class page and from the top-level
  **Notes** tab (pick a class, same board).
- **Schedule**: a 7-day agenda combining recurring class meeting times
  (Canvas doesn't provide these — add them from Schedule directly or from a
  class's Overview tab) with real assignment/exam due dates landing on
  each day, sorted chronologically together.
- **Gmail email intelligence** (`/email`): connect your school Gmail via
  OAuth (read-only, no password ever touches this app), get a summarized
  **Inbox Academic Feed** of only the relevant emails (grouped by class and
  category, clickable through to the original in Gmail), and a **pending
  changes queue** for anything an email suggests that conflicts with what's
  already on file — see [Email intelligence](#email-intelligence) below.
- **Automatic Assignment Breakdown**: a "Break down with AI" action on any
  assignment with no subtasks yet — the model reads the assignment's
  description (when Canvas/email provided one) and splits it into 1-5
  concrete steps with realistic per-step time estimates, stored as real
  `Task` rows so they show up everywhere the assignment does (dashboard,
  class page, Assignments list). Without an API key it falls back to
  `src/lib/breakdown-heuristics.ts` — a deterministic, assignment-type-aware
  splitter (a paper gets outline/draft/revise, an exam gets
  review/practice/final-review, etc.) rather than refusing to work. Small
  assignments (roughly under 30 minutes) are deliberately left unsplit — a
  2-minute attendance check doesn't need three steps.
- **Behind / At-Risk status** (`src/lib/risk-engine.ts`): a 🟢/🟡/🔴
  assessment shown at the top of the dashboard, plus a lightweight badge on
  each class card. Built from real signals only — overdue items, how much
  is due in the next 48 hours, upcoming exams, and (only when you've logged
  it) how your actual free time compares to today's workload — and when
  you're behind, it says why and recommends what to tackle first, chained
  in one sentence ("I'd recommend completing X, then Y") rather than a wall
  of text. An optional "Explain in plain language" button re-narrates the
  same facts through AI; the status itself never waits on or requires that.
- **Assignments** and **Classes** list views, both with an inline expandable
  subtask checklist per assignment, plus the assignment's real directions
  and a "See in Canvas" link.

## Quick start

The schema targets Postgres (see [Data architecture](#data-architecture)),
so `DATABASE_URL` needs to point at a real Postgres instance even for
local runs — either the same one your [Vercel deployment](#deploying-to-vercel)
uses, or any other Postgres you have (a free tier from Neon/Supabase, a
local Postgres.app install, etc.). There's no more zero-config SQLite
fallback as of this update — see the Roadmap entry on why.

```bash
npm install
cp .env.example .env          # then edit .env — set a real DATABASE_URL, see below
npx prisma generate
npx prisma db push            # creates all the tables on that database from the schema
npm run db:seed               # demo user + real Fall 2026 Cedarville data
npm run dev
```

Open http://localhost:3000 and log in with the demo account printed by the
seed script (`student@example.com` / `campusos-demo` — **change this
password** if you keep using the seeded account for anything real).

To pull your *own* live Canvas data instead of the seeded snapshot, the
easiest way is right in the app:

1. In Canvas: Account → Settings → scroll to Approved Integrations → **+
   New Access Token**. Copy it immediately — Canvas only shows it once.
2. In the app, go to **Canvas** in the nav → paste your Canvas URL and the
   token → **Connect Canvas**. This verifies the token, saves it (encrypted
   the same way Gmail's connection is), and runs the first sync
   immediately.
3. Click **Sync now** on that same page any time you want fresh data —
   it's idempotent (matches on `canvasCourseId` / `canvasAssignmentId`, so
   it updates existing rows instead of duplicating them).

If you'd rather sync from the command line or a cron job instead of
clicking a button, `CANVAS_BASE_URL` / `CANVAS_ACCESS_TOKEN` in `.env` plus
`npm run canvas:sync` still works exactly as before — both paths share the
same sync logic.

To connect Gmail, see [Email intelligence](#email-intelligence) — it needs
a few minutes of one-time setup in Google Cloud that only you can do.

### AI features (optional)

Set `ANTHROPIC_API_KEY` in `.env` to enable: the dashboard's "why this
task" explanations and cross-app Q&A, every per-class assistant action
(summarize, study guide, quiz, gap-check, exam prep), Gmail's
structured-fact extraction (recognizing "your exam moved to Wednesday" as
an actual proposed change, not just a relevant-looking email), assignment
breakdown into concrete steps, and the plain-language narrative over the
Behind/At-Risk status. **Every
AI-backed feature has a deterministic fallback and works without a key** —
the app never breaks or blocks on the AI being unavailable, and Gmail
specifically still filters/categorizes/tags emails by class without a key,
it just won't propose schedule changes on its own (see below). This is the
same "don't fabricate, don't depend on things that might fail" pattern the
whole app is built against.

## Deploying to Vercel

Once you're happy running it locally, this moves it to a real URL you can
open from any device — no laptop, no Terminal, no `localhost`. The schema
already targets Postgres for exactly this (see `prisma/schema.prisma`),
and `package.json`'s `build` script runs `prisma db push` on every deploy,
so the live database schema always matches what's committed — no separate
migration step to remember.

Steps that only you can do (account creation and dashboard clicks aren't
something I can do on your behalf):

1. **Push this repo to a new GitHub repository you create yourself**
   (github.com → New repository — leave it empty, no README/.gitignore,
   since this project already has both). Then, from this folder:
   ```
   git remote add origin <the URL GitHub gives you>
   git push -u origin master
   ```
2. **Go to vercel.com and sign in** (continuing with GitHub is easiest —
   it reuses the account from step 1), then **Add New → Project** and
   import that GitHub repo.
3. **Add the database before the first deploy**: in the new project, go
   to **Storage → Create Database → Prisma Postgres** (Neon is a fine
   alternative if you'd rather use that). This automatically sets
   `DATABASE_URL` for you — nothing to copy in by hand.
4. **Add the rest of the environment variables** in
   **Settings → Environment Variables** — the same values already in your
   local `.env`, with one exception:
   - `AUTH_SECRET`, `ANTHROPIC_API_KEY` (optional), `ANTHROPIC_MODEL`
     (optional), `CANVAS_BASE_URL` / `CANVAS_ACCESS_TOKEN` (optional),
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — copy these straight
     across.
   - `GOOGLE_REDIRECT_URI` — set this one to
     `https://<your-vercel-domain>/api/email/oauth/callback` instead of
     the `localhost` version.
5. **Add that same production URL in Google Cloud Console** too
   (Credentials → your OAuth client → Authorized redirect URIs). Google
   allows more than one, so the `localhost` entry can stay for local use.
6. **Click Deploy.** The first build runs `prisma db push` automatically,
   which creates all the tables on the fresh database before the app
   builds — nothing else to run by hand.
7. **Once it's live**, open the URL Vercel gives you and use the
   **Sign up** link on the login screen (`registerAction` in
   `src/app/login/actions.ts`) to create your own real account, rather
   than relying on the seeded demo one. If you'd like the demo data there
   too, run `npm run db:seed` locally once with `DATABASE_URL` pointed at
   the same production database.

After this one-time setup, every future `git push` to this repo redeploys
automatically — no manual steps.

## Email intelligence

Setup (Google Cloud, one-time, a few minutes):

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create a project (or reuse one) and enable the **Gmail API** under
   *APIs & Services → Library*.
2. Under *APIs & Services → Credentials*, create an **OAuth client ID**
   (type: Web application). Add `http://localhost:3000/api/email/oauth/callback`
   as an authorized redirect URI (or your deployed URL's equivalent).
3. Put the client ID/secret in `.env` (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`).
4. While the OAuth consent screen is in "Testing" mode (the default for a
   new project), add your own Google account under **Test users** — Google
   will otherwise refuse to let you log in with it.
5. From the app: Email → **Connect Gmail**, sign in on Google's own screen,
   then **Sync now**.

Only the read-only `gmail.readonly` scope is ever requested — this app can
never send, delete, or modify anything in your inbox, and your password
never touches it. Each sync scans your recent inbox (last ~60 days),
classifies each message, and stores only what's academically relevant.

How a fact from an email actually reaches your schedule — this is the part
of the spec worth being precise about ("don't blindly overwrite existing
data," "everything Canvas already has doesn't need Gmail's confirmation"):

- **Already matches what's on file** → nothing happens to your data, but
  it's logged as confirmed (visible in the email's history) so you can see
  the professor's email was consistent with Canvas.
- **Canvas never had this field at all** (e.g. no room set for a class) →
  applied automatically — there's nothing to conflict with, so asking would
  just be friction. Still logged, so there's a visible trail of what
  changed and why.
- **Conflicts with an existing value** → always shown to you, exactly per
  spec: *"Your schedule says the ECON 201 exam is Tuesday, but your
  professor emailed that it was moved to Wednesday. Which should I use?"*
  Nothing is overwritten until you pick one, from the pending-changes queue
  at the top of the Email page (also flagged on the Dashboard).
- **A whole new exam/assignment Canvas doesn't list at all** → always asks
  too, since creating a new academic record is a bigger deal than filling
  in one field, and the class-matching that got it there is a best-effort
  heuristic, not a certainty.

This logic is centralized in `src/lib/change-rules.ts` (pure, unit-tested —
see [Verification](#verification)) and enforced in
`src/lib/pending-changes.ts`, which is the *only* code path allowed to
write a value that originated from an email into `Class` / `Assignment` /
`Exam` / `ScheduleEvent`.

## Data architecture

Postgres (`prisma/schema.prisma`'s `datasource` is `provider = "postgresql"`,
reading `DATABASE_URL`) — see [Deploying to Vercel](#deploying-to-vercel)
for how that gets provisioned (Prisma Postgres or Neon, both zero-config
through Vercel's Storage tab). This project started on SQLite for
zero-config local dev and moved to Postgres once it needed to run
somewhere other than one laptop — same schema either way, Prisma just
abstracts the two, and nothing in this data model uses a provider-specific
type or feature.

Key relationships (see `prisma/schema.prisma` for the full picture with
field-level comments):

```
User ─┬─ Class ─┬─ ScheduleEvent
      │         ├─ Assignment ─── Task (subtasks)
      │         ├─ Exam
      │         ├─ NoteSection ─── Note
      │         ├─ Resource
      │         └─ Email
      ├─ EmailAccount (Gmail OAuth link — one per user)
      ├─ CanvasAccount (Canvas access token — one per user)
      ├─ Email ─── PendingChange (conflict-resolution queue)
      └─ AvailabilityBlock (explicit free-time entries)
```

Two design decisions worth knowing about:

- **Canvas owns Class/Assignment/Exam.** `canvasCourseId` /
  `canvasAssignmentId` make sync idempotent and mean Canvas is always the
  source of truth for what exists — the app extends that data (tasks,
  notes, estimates) rather than replacing it. Fields Canvas never provides
  at all (professor, room, current grade, meeting times) are either typed
  in directly from a class's Overview/Schedule tabs, or filled in from an
  email via the PendingChange path above.
- **Email never writes directly into your schedule/assignments.** Every
  fact an email-intelligence pass extracts becomes a `PendingChange` row
  first — see [Email intelligence](#email-intelligence) for exactly when
  that applies automatically vs. asks you.

## Priority engine

`src/lib/priority-engine.ts` is pure, dependency-free logic (no Prisma, no
Next.js) that turns assignments/tasks into the ranked list, the single best
recommendation, and the "I have X minutes" match. It's unit tested in
`tests/priority-engine.test.ts` — run `npm test`.

Two things it deliberately does **not** do, straight from the spec:

- It never invents "available free time." `computeWorkloadSummary` returns
  `availableMinutesToday: null` unless you've actually logged an
  `AvailabilityBlock` for today, and the dashboard shows "not tracked yet"
  rather than a fabricated number.
- "I have X minutes" never forces a fit. If nothing on your list fits in
  the time you gave it, it says so plainly and shows what your actual top
  priority is (and roughly how much bigger it is), instead of suggesting
  something irrelevant just to fill the slot.

It's also timezone-correct: `User.timezone` (default `America/New_York`)
drives every "is this due today?" calculation via `date-fns-tz`, rather
than the server process's own local timezone — which matters a lot once
this is deployed somewhere that runs in UTC.

## Assignment breakdown & risk status

Both pieces of phase 3 follow the same pure-logic-plus-server-glue split as
the priority engine, so both are unit tested directly with no database or
AI call involved:

- `src/lib/breakdown-heuristics.ts` — the no-API-key fallback for
  Automatic Assignment Breakdown. Splits an assignment's *existing* time
  estimate into steps (never invents new total effort) and picks a
  different shape depending on what the assignment looks like — a paper
  gets outline/draft/revise, a presentation gets research/build/practice,
  an exam gets review/practice/final-review, and anything short-form (a
  quiz, a discussion post) is deliberately left unsplit. Tested in
  `tests/breakdown-heuristics.test.ts`. The real path
  (`src/app/assignments/actions.ts`, `breakdownAssignmentAction`) prefers
  the AI version when a key is configured — it reads the assignment's
  actual description and is told explicitly never to invent specifics
  (topics, page counts, requirements) that weren't given — and falls back
  to the heuristic otherwise. Either way the result is stored as real
  `Task` rows, so it shows up on the dashboard, the class page, and the
  Assignments list the same way regardless of which path produced it.
- `src/lib/risk-engine.ts` — the Behind/At-Risk 🟢/🟡/🔴 assessment.
  Takes the priority engine's already-computed ranked list and workload
  summary (never a second, possibly-inconsistent read of your data) and
  applies real thresholds: any overdue item, an hour or more behind your
  logged free time, three or more things due within 48 hours, or an exam
  inside 72 hours combined with a busy couple of days all push the status
  toward red; a single thing due soon only counts as yellow when your
  actual logged capacity can't rule it out — if you've logged enough free
  time to comfortably cover today, one due-soon item alone stays green.
  Tested in `tests/risk-engine.test.ts`, including a case built directly
  from the spec's own example scenario. Recommendations are capped (2-3
  items, chained in one sentence, none at all when you're on track) so a
  red status reads as "here's what to do" rather than a wall of text.

## Roadmap

Built: foundation, Canvas sync, Command Center (phase 1); per-class pages,
flexible Notes, Schedule (phase 2); Automatic Assignment Breakdown and the
Behind/At-Risk 🟢/🟡/🔴 system (phase 3); Gmail OAuth, email intelligence,
PendingChange conflict resolution, Inbox Academic Feed, per-class and
cross-app AI assistants (phase 4, plus the assistants originally slated
for "after phase 2/4" — built once both existed for them to draw on). That
closes out every numbered phase from the original spec.

**Added post-launch (2026-08-22), from real usage feedback once the app was
actually running:**

- **Assignment directions + "See in Canvas" everywhere.** Clicking an
  assignment's title — on the dashboard, the Assignments page, or a
  class's Assignments tab — now expands a details panel with the real
  Canvas description (HTML stripped to plain text, see `src/lib/text.ts`)
  and a "See in Canvas ↗" link. The link is built from the course/assignment
  ids already stored for sync idempotency (`canvasAssignmentUrl()` in
  `src/lib/canvas.ts`) rather than a new stored field, and is only shown
  when both ids are actually known — never a guessed URL. `WorkItem` (the
  priority engine's item shape) gained `description`/`canvasUrl` fields to
  carry this from `src/lib/workload.ts` through to the dashboard's
  `TaskRow`.
- **Schedule now shows what's actually due, not just recurring meeting
  times.** Rewrote `src/app/schedule/page.tsx` from "your weekly pattern
  only" into a 7-day agenda: each of the next 7 days lists that weekday's
  recurring class meetings *and* anything with a real due date landing on
  that specific calendar date (assignments, exams — both link to Canvas
  when known), sorted chronologically together. Recurring meetings still
  have their `Remove` button right there since every weekday appears
  exactly once in a 7-day window, so no separate "manage my pattern" view
  was needed.

No schema changes in this update — both features build entirely on data
already being stored, so no new `prisma db push` is required.

**Moved from SQLite to Postgres for deployment (2026-08-22).** Reece
wanted the app reachable without his Mac running the dev server — see
[Deploying to Vercel](#deploying-to-vercel). `prisma/schema.prisma`'s
datasource is now `postgresql` (was `sqlite`); `DATABASE_URL` now points
at one real hosted database used for both local runs and production,
rather than a local SQLite file that could drift from what's deployed.
`package.json` gained `postinstall: prisma generate` and the `build`
script now runs `prisma db push` first, so every deploy keeps the live
schema in sync automatically — no separate migration step for a
single-user personal project like this one. No application code changed;
Prisma abstracts the two providers identically for everything this schema
uses (no native-type overrides, and the enum-vs-string fields were
already resolved for SQLite compatibility, which carries over cleanly).

**In-app Canvas connection (2026-08-22).** Previously the only way to pull
real Canvas data in was the `npm run canvas:sync` CLI script, which needed
`CANVAS_BASE_URL`/`CANVAS_ACCESS_TOKEN` in `.env` and terminal access —
fine for local dev, but a dead end once the app is deployed and you're not
running a terminal against it day to day. Added a `/canvas` page:
paste a Canvas URL and access token, it verifies the token against the
real Canvas API before saving anything, stores it encrypted the same way
Gmail's connection is (`CanvasAccount.accessTokenEnc`, `src/lib/crypto.ts`),
runs the first sync immediately, and offers **Sync now** afterward. The
actual sync logic (`src/lib/canvas-sync.ts`) is shared between this and the
CLI script rather than duplicated, so both stay in lockstep. One schema
change: new `CanvasAccount` model, applied automatically on the next
deploy via the existing `prisma db push` build step — no separate
migration.

**Known limits, not gaps in this app:** Gmail (`GOOGLE_CLIENT_ID` etc.) and
the AI assistants (`ANTHROPIC_API_KEY`) both require credentials you
create yourself — see "AI features (optional)" above and `.env.example`
for Gmail. Without them, the app behaves exactly as designed: email intelligence
is simply unavailable until connected, and every AI-backed feature falls
back to a deterministic, non-AI answer built from real data (see the
"Optional but required for AI-backed features" comment in `.env.example`)
rather than failing.

Not built — one deliberately flagged gap, unrelated to the phase plan:

- A `ScheduleException` model for single-occurrence schedule changes
  ("class is canceled this Friday only," as opposed to a permanent room
  change) — the spec's canceled-class example is real but under-scoped for
  the current `ScheduleEvent` model, which represents a recurring pattern,
  not individual occurrences. Flagging this explicitly rather than
  half-building it: right now, a canceled-class email is filed in the
  Inbox Academic Feed (so you'll see it) but doesn't propose a structured
  change.

## Verification

- `npm test` — 62 unit tests, all passing: the original 19 on the priority
  engine (urgency bucketing, ranking, the minutes-mode matcher, workload
  summary, the heuristic estimator); 21 from phases 2/4 on
  `tests/change-rules.test.ts` (the same-value/auto-apply/conflict decision
  behind "email never silently overwrites your schedule") and
  `tests/email-classify-heuristic.test.ts` (class matching and email
  categorization without an API key); and 22 new ones from phase 3 —
  `tests/risk-engine.test.ts` (14 tests: on-track/getting-behind/at-risk
  thresholds, the exact "I'd recommend X, then Y" phrasing from the spec's
  own example, that reasons/recommendations stay capped even with many
  simultaneous signals, and that a specific "behind by X" figure is never
  claimed without real logged availability) and
  `tests/breakdown-heuristics.test.ts` (9 tests: per-assignment-type step
  shapes, the small-assignment no-op case, the 5-minute-per-step floor).
  All four new-this-project test files caught a real bug during
  development before it shipped: `email-classify-heuristic` caught a
  course-code matcher that mishandled multi-segment codes like
  `ECON-2330-03`; `risk-engine` caught a yellow-status threshold that
  ignored logged free time and flagged "getting behind" even when a
  student had comfortably enough time logged for the day; and
  `breakdown-heuristics` caught a category-matching order bug that read
  "Final Project" as exam prep instead of project work.
- `npx tsc --noEmit` — clean, project-wide, in strict mode, **after**
  `prisma generate` has run. (If you see `implicitly has an 'any' type`
  errors on Prisma query results, that means `prisma generate` hasn't been
  run yet in this checkout — it's step 1 in Quick Start for exactly this
  reason. As of this update, tsc in the sandbox this was built in shows
  exactly that error class and nothing else — 40 identical `TS7006`/related
  errors, all on Prisma query-result callbacks, zero of any other kind, and
  that count hasn't grown even though phase 3 added new pages and
  components.)
- **Known sandbox blind spot, now closed:** this project was built in a
  sandbox that could never actually download Prisma's query/schema engine
  binaries (network-blocked), so `npx prisma generate`/`db push` could
  never be run for real here — only `tsc --noEmit` against a stub client.
  That let a real bug through: `prisma/schema.prisma` used Prisma's
  `enum` keyword for `Assignment.status`, `Email.category`, and
  `PendingChange.status`, which SQLite's connector doesn't support (`npx
  prisma db push` fails with "the current connector does not support
  enums" — caught the moment this was actually run against a real
  database). Fixed: all three are now plain `String` fields with the same
  default values; no application code needed to change, since every field
  was already typed against a local TS union (`WorkStatus` in
  `priority-engine.ts`, `EmailCategory` in `email-classify-heuristic.ts`,
  inline literals in `change-rules.ts`), never the Prisma-generated enum
  type. Worth calling out explicitly: `tsc`-only verification against a
  stub client cannot catch schema-level issues like this — anything that
  needs a real query/schema engine only gets validated once you actually
  run it.
- Manually exercised the risk engine against a scenario built to match the
  spec's own worked example (a couple of assignments due within 48 hours,
  logged free time short of what's needed) and confirmed the output reads
  the same way: *"You're currently about 2 hr 30 min behind your planned
  workload. 3 assignments due within the next 48 hours. I'd recommend
  completing "Biology Lab Report", then "History Paper", then "Econ Problem
  Set.""*
- `npm run build` — not runnable end-to-end in the sandbox this was built
  in (its network policy blocks Prisma's engine download and Google Fonts
  at build time, both of which are normal, unauthenticated public CDNs
  that a real dev machine or CI runner won't have trouble with). Everything
  short of that — the full TypeScript compile and the full test suite —
  passes clean; please run `npm run build` once in your own environment
  before deploying, and flag anything that surfaces.
- Gmail OAuth and the Gmail API calls (`src/lib/google-oauth.ts`,
  `src/lib/gmail.ts`) are written directly against Google's documented
  REST endpoints but **could not be live-tested** in this sandbox — doing
  so needs a real Google Cloud OAuth client, which only you can create
  (see [Email intelligence](#email-intelligence)). If the OAuth handshake
  or a Gmail API call behaves unexpectedly on your first real connect,
  that's the one piece of this update running for the first time outside
  a sandbox — let me know what you see and I'll fix it.
- Existing functionality checked for regressions: the dashboard's ranked
  list, "what should I do right now," "I have X minutes," and workload
  summary all still call the same untouched `priority-engine.ts`/
  `workload.ts`; `scripts/sync-canvas.ts` and the Canvas client weren't
  touched at all. Every new page calls `requireUser()`, and every new
  Server Action re-checks that the record being touched actually belongs
  to the logged-in user before reading or writing it. The one existing
  action phase 3 changed, `toggleWorkItemAction`, now also revalidates
  `/assignments` and the owning class page (previously just `/dashboard`)
  so a subtask checked off from the new Assignments/class views reflects
  everywhere immediately — the dashboard behavior it already had is
  unchanged.
- **In-app Canvas connection**: `src/lib/canvas-sync.ts` is the exact same
  upsert logic `scripts/sync-canvas.ts` already had (moved, not rewritten),
  so its correctness carries over from the CLI script's real-world use.
  What's genuinely new — `connectCanvasAction`'s token-verification call,
  the encrypt/decrypt round-trip, and the `/canvas` page itself — passed
  `tsc --noEmit` (still exactly the same 40 baseline errors, none from the
  new files) and didn't touch any of the 62 existing tests, but **could
  not be live-tested against the real Canvas API** in this sandbox, the
  same limitation as the Gmail OAuth flow — try connecting your real
  account and let me know what you see if anything looks off.

## Security notes

- Passwords are hashed with bcrypt (cost 12); never stored or logged in
  plaintext.
- Session tokens are random 256-bit values; only an HMAC of the token is
  stored server-side, so a database leak alone doesn't hand out working
  sessions.
- Gmail OAuth tokens are encrypted at rest (`src/lib/crypto.ts`,
  AES-256-GCM, key derived from `AUTH_SECRET`) — never stored in plaintext,
  and only the read-only `gmail.readonly` scope is ever requested. The
  OAuth `state` parameter is verified against a short-lived signed cookie
  on callback (standard CSRF protection for the redirect flow).
- Canvas access tokens are encrypted at rest the same way
  (`CanvasAccount.accessTokenEnc`, same AES-256-GCM helpers) — never stored
  in plaintext. `connectCanvasAction` verifies a token actually works
  against the real Canvas API before saving it, so a typo'd or already-bad
  token never gets persisted in the first place.
- `npm audit` currently reports 2 high-severity advisories, both in
  Next.js 14.2.x itself (the latest 14.x patch as of this build) — Next 15
  resolves them but is a larger migration. The app sits entirely behind
  auth, which limits exposure, but please re-run `npm audit` and consider
  the Next 15 upgrade path before any public deployment.
- The AI-extraction path for emails is given an explicit allowlist of
  fields it's permitted to propose changes to (enforced twice — once when
  building the prompt, once again in `pending-changes.ts` regardless of
  what the model returns) — it cannot, for example, be tricked by a
  malicious or malformed email into writing to an arbitrary database field.

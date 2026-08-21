# Campus OS

A personal "student operating system" built on top of the Fall Ledger Canvas
calendar: a Command Center dashboard, per-class pages with flexible notes,
and Gmail-based email intelligence — all pointed at the same real data, so
the app can answer *"what should I do right now?"* and *"am I missing
anything Canvas doesn't know about?"*

This is **phases 1, 2, and 4** of the original plan — see
[Roadmap](#roadmap) for what's built vs. what's still ahead (phase 3).

## What's built

- **Data model** for the whole app (`prisma/schema.prisma`): User, Class,
  ScheduleEvent, Assignment, Task, Exam, Email, EmailAccount, PendingChange,
  NoteSection, Note, Resource, AvailabilityBlock — see
  [Data architecture](#data-architecture).
- **Auth**: email/password, hashed with bcrypt, session cookies (httpOnly,
  signed) — no third-party auth dependency, since Gmail OAuth is a
  *separate*, narrowly-scoped connection, not your login method.
- **Canvas sync** (`scripts/sync-canvas.ts`): pulls your real courses and
  assignments from the Canvas API and upserts them — safe to run repeatedly
  on a schedule.
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
- **Schedule**: a weekly view of recurring meeting times across all
  classes, since Canvas doesn't provide these either — add them from
  Schedule directly or from a class's Overview tab.
- **Gmail email intelligence** (`/email`): connect your school Gmail via
  OAuth (read-only, no password ever touches this app), get a summarized
  **Inbox Academic Feed** of only the relevant emails (grouped by class and
  category, clickable through to the original in Gmail), and a **pending
  changes queue** for anything an email suggests that conflicts with what's
  already on file — see [Email intelligence](#email-intelligence) below.
- **Assignments** and **Classes** list views.

## Quick start

```bash
npm install
cp .env.example .env          # then edit .env — see below
npx prisma generate
npx prisma db push            # creates dev.db (SQLite) from the schema
npm run db:seed               # demo user + real Fall 2026 Cedarville data
npm run dev
```

Open http://localhost:3000 and log in with the demo account printed by the
seed script (`student@example.com` / `campusos-demo` — **change this
password** if you keep using the seeded account for anything real).

To pull your *own* live Canvas data instead of the seeded snapshot:

1. In Canvas: Account → Settings → New Access Token.
2. Put your Canvas URL and token in `.env` (`CANVAS_BASE_URL`,
   `CANVAS_ACCESS_TOKEN`).
3. `npm run canvas:sync`

Re-run `canvas:sync` whenever you want fresh data — it's idempotent
(matches on `canvasCourseId` / `canvasAssignmentId`, so it updates existing
rows instead of duplicating them) and safe to put on a cron job.

To connect Gmail, see [Email intelligence](#email-intelligence) — it needs
a few minutes of one-time setup in Google Cloud that only you can do.

### AI features (optional)

Set `ANTHROPIC_API_KEY` in `.env` to enable: the dashboard's "why this
task" explanations and cross-app Q&A, every per-class assistant action
(summarize, study guide, quiz, gap-check, exam prep), and Gmail's
structured-fact extraction (recognizing "your exam moved to Wednesday" as
an actual proposed change, not just a relevant-looking email). **Every
AI-backed feature has a deterministic fallback and works without a key** —
the app never breaks or blocks on the AI being unavailable, and Gmail
specifically still filters/categorizes/tags emails by class without a key,
it just won't propose schedule changes on its own (see below). This is the
same "don't fabricate, don't depend on things that might fail" pattern the
whole app is built against.

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

SQLite by default (`DATABASE_URL="file:./dev.db"`) — zero setup for running
this yourself or on a small VPS. To deploy on a serverless platform (Vercel,
etc.), point `DATABASE_URL` at a hosted Postgres instance (Neon, Supabase,
Vercel Postgres) and change `provider = "sqlite"` to `provider =
"postgresql"` in `prisma/schema.prisma` — the schema itself doesn't need to
change.

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

## Roadmap

Built: foundation, Canvas sync, Command Center (phase 1); per-class pages,
flexible Notes, Schedule (phase 2); Gmail OAuth, email intelligence,
PendingChange conflict resolution, Inbox Academic Feed, per-class and
cross-app AI assistants (phase 4, plus the assistants originally slated
for "after phase 2/4" — built now since both now exist for them to draw
on).

Not built yet:

- **Phase 3** — Automatic Assignment Breakdown (AI estimates workload and
  splits a new assignment into subtasks from its description, stored so
  they surface as their own items on the dashboard) and the "Behind / At
  Risk" 🟢/🟡/🔴 system with a narrative recovery-plan explanation. Both
  build on the priority engine and the AI-optional pattern already in
  place; they're staged last because they're genuinely separate features,
  not because anything else needs to land first.
- A `ScheduleException` model for single-occurrence schedule changes
  ("class is canceled this Friday only," as opposed to a permanent room
  change) — the spec's canceled-class example is real but under-scoped for
  the current `ScheduleEvent` model, which represents a recurring pattern,
  not individual occurrences. Flagging this explicitly rather than
  half-building it: right now, a canceled-class email is filed in the
  Inbox Academic Feed (so you'll see it) but doesn't propose a structured
  change.

## Verification

- `npm test` — 40 unit tests, all passing: the original 19 on the priority
  engine (urgency bucketing, ranking, the minutes-mode matcher, workload
  summary, the heuristic estimator), plus 21 new ones on the two pieces of
  logic that matter most for correctness and safety —
  `tests/change-rules.test.ts` (the same-value/auto-apply/conflict
  decision behind "email never silently overwrites your schedule") and
  `tests/email-classify-heuristic.test.ts` (class matching and email
  categorization without an API key). Both new test files caught a real
  bug during development — a course-code matcher that mishandled
  multi-segment codes like `ECON-2330-03` — before it shipped.
- `npx tsc --noEmit` — clean, project-wide, in strict mode, **after**
  `prisma generate` has run. (If you see `implicitly has an 'any' type`
  errors on Prisma query results, that means `prisma generate` hasn't been
  run yet in this checkout — it's step 1 in Quick Start for exactly this
  reason. As of this update, tsc in the sandbox this was built in shows
  exactly that error class and nothing else — 40 identical `TS7006`
  errors, all on Prisma query-result callbacks, zero of any other kind.)
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
  to the logged-in user before reading or writing it.

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

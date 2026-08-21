# Campus OS

A personal "student operating system" built on top of the Fall Ledger Canvas
calendar: a Command Center dashboard that looks at your classes, assignments,
due dates, and (soon) email, and answers *"what should I do right now?"*

This is **phase 1** of a larger plan — see [Roadmap](#roadmap) below for what's
built vs. what's coming next.

## What's in phase 1

- **Data model** for the whole app (`prisma/schema.prisma`): User, Class,
  ScheduleEvent, Assignment, Task, Exam, Email, EmailAccount, PendingChange,
  NoteSection, Note, Resource, AvailabilityBlock — see
  [Data architecture](#data-architecture).
- **Auth**: email/password, hashed with bcrypt, session cookies (httpOnly,
  signed) — no third-party auth dependency, since Gmail OAuth (phase 4) is a
  *separate*, narrowly-scoped connection, not your login method.
- **Canvas sync** (`scripts/sync-canvas.ts`): pulls your real courses and
  assignments from the Canvas API and upserts them — safe to run repeatedly
  on a schedule.
- **Command Center dashboard**: a ranked "what should I do" list, a
  **"What should I do right now?"** button, an **"I have X minutes"** finder,
  and a workload summary (overdue / due today / due tomorrow, remaining
  work, and — only if you've logged it — how much free time you have and
  whether you're ahead or behind).
- **Assignments** and **Classes** list views.
- Placeholder pages for **Schedule**, **Email**, and **Notes**, so the
  navigation from the spec is all there — these get built out in phases 2–4.

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

### AI features (optional)

Set `ANTHROPIC_API_KEY` in `.env` to enable the AI-polished explanation
behind "What should I do right now?" (phase 1) and, in later phases, the
assignment-breakdown estimator and per-class assistant. **Every AI-backed
feature has a deterministic fallback and works without a key** — the app
never breaks or blocks on the AI being unavailable, per the "don't
fabricate, don't depend on things that might fail" requirement this was
built against.

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
      ├─ EmailAccount (Gmail OAuth link, phase 4)
      ├─ Email ─── PendingChange (conflict-resolution queue, phase 4)
      └─ AvailabilityBlock (explicit free-time entries)
```

Two design decisions worth knowing about:

- **Canvas owns Class/Assignment/Exam.** `canvasCourseId` /
  `canvasAssignmentId` make sync idempotent and mean Canvas is always the
  source of truth for what exists — the app extends that data (tasks,
  notes, estimates) rather than replacing it.
- **Email never writes directly into your schedule/assignments.** Every
  fact an email-intelligence pass extracts becomes a `PendingChange` row
  first. Nothing touches `Class`/`Assignment`/`Exam`/`ScheduleEvent` until
  you accept it (or, for a genuinely unambiguous *new* fact with no
  existing conflicting value, it can apply automatically — but a
  conflicting value never gets silently overwritten). This is the
  mechanism behind the "your schedule says Tuesday, but the professor
  emailed Wednesday — which should I use?" requirement.

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

Built this turn (phase 1): foundation, Canvas sync, Command Center.

Not built yet — planned as incremental follow-ups so each phase ships as a
reviewable, working slice rather than one giant change:

- **Phase 2** — Per-class pages (overview, professor/room/meeting times,
  assignments, exams, resources), the flexible Notes system (create/
  rename/delete/reorder sections, pin/search notes), and the Schedule
  weekly view.
- **Phase 3** — AI assignment breakdown (estimate + subtasks from the
  assignment description), and the Behind/At-Risk system with a narrative
  recovery-plan explanation.
- **Phase 4** — Gmail OAuth (Cedarville is a Google Workspace school, not
  Microsoft 365 — confirmed against Cedarville IT's own documentation),
  the email → PendingChange extraction pipeline, and the Inbox Academic
  Feed.
- Per-class AI assistant and the fuller cross-app assistant (once notes/
  resources/email exist for it to actually draw on — building it before
  phase 2/4 would mean it has nothing real to reason over).

## Verification

- `npm test` — 19 unit tests on the priority engine (urgency bucketing,
  ranking, the minutes-mode matcher, workload summary, the heuristic
  estimator), all passing.
- `npx tsc --noEmit` — clean, project-wide, in strict mode, **after**
  `prisma generate` has run. (If you see `implicitly has an 'any' type`
  errors on Prisma query results, that means `prisma generate` hasn't been
  run yet in this checkout — it's step 1 in Quick Start for exactly this
  reason.)
- `npm run build` — not runnable end-to-end in the sandbox this was built
  in (its network policy blocks Prisma's engine download and Google Fonts
  at build time, both of which are normal, unauthenticated public CDNs
  that a real dev machine or CI runner won't have trouble with). Everything
  short of that — the full TypeScript compile and the priority-engine test
  suite — passes clean; please run `npm run build` once in your own
  environment before deploying, and let me know if anything surfaces.

## Security notes

- Passwords are hashed with bcrypt (cost 12); never stored or logged in
  plaintext.
- Session tokens are random 256-bit values; only an HMAC of the token is
  stored server-side, so a database leak alone doesn't hand out working
  sessions.
- `npm audit` currently reports 2 high-severity advisories, both in
  Next.js 14.2.x itself (the latest 14.x patch as of this build) — Next 15
  resolves them but is a larger migration. The app sits entirely behind
  auth, which limits exposure, but please re-run `npm audit` and consider
  the Next 15 upgrade path before any public deployment.
- Phase 4's Gmail integration will store OAuth tokens encrypted at rest
  (`src/lib/crypto.ts`, AES-256-GCM) and will only ever request the
  read-only Gmail scope — never your password, never write access.

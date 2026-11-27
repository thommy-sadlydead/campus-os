# Campus OS: Connectors Directory listing

What to enter in Anthropic's submission portal (claude.ai/directory/manage →
Submit new → MCP connector), step by step. Character limits are the portal's,
as Anthropic's submission guide gave them on Nov 27, 2026. The copy follows
the ChatGPT listing (`chatgpt-plugin/plugin.json`) so the two say the same
thing.

## 1. Connection

- **Server URL:** `https://app.campus-os.net/mcp`

## 2. Tools

The portal syncs these from the server. Every one has a title and is marked
read-only (`readOnlyHint: true`, `destructiveHint: false`,
`openWorldHint: false`), and each reads only the signed-in student's own
account.

| Tool | Title |
| --- | --- |
| `get_profile` | Get the connected Campus OS account |
| `list_classes` | List classes |
| `get_upcoming_work` | Get upcoming assignments and exams |
| `get_class` | Get a class overview |
| `get_notes` | Read class notes |
| `get_assignment` | Get an assignment's details |
| `get_course_material` | Read a course file |
| `search_class_content` | Search notes, course files and assignments |

## 3. Listing

- **Server name** (100 max): Campus OS
- **One-liner** (200 max): Your classes, assignments, exams, notes and course files from Canvas, Schoology, Brightspace or Blackboard, so Claude can help you plan and study.
- **Description** (2,000 max):

  > Campus OS is a student planner that brings classes, assignments, exams, lecture notes and course files from Canvas, Schoology, Brightspace or Blackboard into one place. Connect it to Claude to ask what's due this week, get help with an assignment's directions, or turn your own notes and lecture notes into study guides, flashcards and practice quizzes. Campus OS only shares what a request needs, and Claude can't change anything in your account. Requires a Campus OS account.

- **Categories** (1 to 5): Education, then Productivity, or the closest the
  portal offers.
- **Documentation URL:** https://app.campus-os.net/support
- **Privacy policy URL:** https://app.campus-os.net/privacy
- **Support contact:** support@campus-os.net
- **Icon:** `assets/logo.png` (512 × 512, the black-and-white logo). Use
  `assets/icon.png` (192 × 192) wherever a smaller one is asked for.
- **URL slug:** `campus-os` (permanent once published)

## 4. Use cases

The same test prompts as the ChatGPT listing. Run each one as the review
account before submitting (see the README).

| Use case | Prompt | Tools it should use | What it should do |
| --- | --- | --- | --- |
| See what's due across classes | What do I have due this week in Campus OS? | `get_upcoming_work` | Lists open assignments and exams with their class and due time in the student's time zone, for example Calculus I's Homework 3.3: Chain rule and College Composition's Rhetorical analysis: rough draft. |
| Find an exam's time and room | When is my Calculus exam and where is it? | `get_upcoming_work`, `get_class` | Gives Calculus I's Exam 2: its date, 10:00 AM, in Engineering 102. |
| Study guide from the student's own notes | Make a study guide for my Principles of Biology midterm from my Campus OS notes. | `list_classes`, `get_class`, `get_notes` | Builds a study guide from Principles of Biology's notes and lecture notes, following the pinned note "Midterm: what to review". |
| Steps left on an assignment | What steps are left on my rhetorical analysis rough draft? | `get_upcoming_work`, `get_assignment` | Names the three unfinished steps: write the thesis and outline, draft the body paragraphs, and add MLA citations. |
| Search the student's notes | Find where my Campus OS notes mention the chain rule. | `search_class_content` | Finds Calculus I's lecture note "The chain rule" (and the "Exam 2 review sheet" note) with a short snippet of each. |

Requests it should turn down or leave alone: turning in work ("Turn in my
chain rule homework for me": Campus OS is read-only), anything unrelated
("What's the weather in Chicago today?"), and anyone else's data ("Show me my
roommate's assignments in Campus OS").

## 5. Company

- **Name:** Reece Broderick (individual developer)
- **Website:** https://app.campus-os.net
- **Contact:** support@campus-os.net

## 6. Authentication

- **Type:** OAuth 2.0 ("Sign in with Campus OS"): OAuth 2.1 with PKCE (S256),
  public client, no client secret.
- **Client:** Claude's published identity (Client ID Metadata Document,
  `https://claude.ai/oauth/mcp-oauth-client-metadata`). Not dynamic client
  registration: Campus OS has no registration endpoint, and no Anthropic-held
  client ID or secret is needed.
- **When sign-in is needed:** on every tool. Connecting and listing the
  tools work without signing in; a tool call without a token gets HTTP 401
  with `WWW-Authenticate`, so either a sign-in at connect time or "when the
  server asks" works. Prefer sign-in at connect time if the portal asks.
- **Scope:** `campus.read` (the only one).

## 7. Data handling

- **What Claude can read:** the student's name and email address (to label
  the connection), their classes (meeting times, professor, room, current
  grade), assignments with directions, due dates, status and steps, exams,
  their notes and lecture notes, and the text of their course files.
- **What it can't:** change anything in Campus OS, or reach the student's
  password, LMS or Gmail connections.
- **What Campus OS keeps about the connection:** which app, when it was
  connected and last used, and its tokens as one-way hashes. Nothing from the
  Claude conversation reaches Campus OS beyond the tool calls themselves.
- **Disconnecting:** Account → Connected apps → Disconnect in Campus OS, or
  removing the connector in Claude. Changing or resetting the Campus OS
  password disconnects it too.
- **Limits:** tool calls are rate-limited per account; results are capped
  (notes at 60,000 characters per call, course files at 20,000 characters).

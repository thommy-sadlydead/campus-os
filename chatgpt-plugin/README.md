# Campus OS for ChatGPT

The Campus OS plugin for the ChatGPT directory: students connect their Campus
OS account in ChatGPT, and ChatGPT can read their classes, assignments,
exams, notes, lecture notes and course files (never change them).

How it works on the website:

- **Sign in with Campus OS** (OAuth 2.1 + PKCE, ChatGPT's client metadata
  document as its client id): `src/lib/oauth/`, the consent page
  `src/app/oauth/authorize`, the token endpoint `src/app/oauth/token`, and the
  discovery documents under `src/app/.well-known/`.
- **The MCP endpoint** `https://<site>/mcp`: `src/app/mcp/route.ts`, with the
  protocol in `src/lib/mcp/protocol.ts` and the tools in
  `src/lib/mcp/tool-defs.ts` (definitions) and `tools-server.ts` (handlers).
- Students see and disconnect it under Account → Connected apps. Changing or
  resetting a password disconnects it too.
- `scripts/check-mcp.mjs` runs the whole flow against a local server.

This folder is the package uploaded to OpenAI: `plugin.json`, `mcp.json`
and `assets/`.

## Before submitting

1. **Move Campus OS to its own domain** (for example `app.campus-os.net`):
   add it in Vercel → the project → Domains, point the DNS record at Vercel
   where the domain is registered, and set `APP_URL` to it. OpenAI never lets
   a published plugin's MCP address change, so do this first. The old
   `vercel.app` address keeps working for the iPhone app.
2. **Change every URL in `plugin.json` and `mcp.json`** to the new domain.
3. **Test it privately in your own ChatGPT**: chatgpt.com/plugins → the plus
   button → **Add custom MCP server**, with the URL `https://<domain>/mcp` and
   OAuth, then **Create as a plugin**. In a new chat, type `@`, pick Campus OS,
   sign in, tap Allow, and try the test prompts below. After changing a tool,
   open it at chatgpt.com/plugins and select **Refresh**.
4. **Verify yourself with OpenAI**: platform.openai.com → Settings →
   Organization → General → individual verification (to publish under your
   own name).

## Submitting

1. platform.openai.com → Plugins → create a plugin, upload this folder as a
   ZIP, and connect the MCP server with **With MCP**: the URL
   `https://<domain>/mcp`, OAuth.
2. **Domain verification**: the portal shows a token. Put it in Vercel as
   `OPENAI_APPS_CHALLENGE` and redeploy; Campus OS serves it at
   `/.well-known/openai-apps-challenge`.
3. **Scan Tools**, then fill in the form. Every tool is read-only:
   `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`
   (it only reads the signed-in student's own account).
4. **Review details** (private to reviewers): the App Store review account
   (`reecebroderick12@gmail.com` and its password). It has no two-factor
   login. Tap Account → Reset sample classes first so the dates are fresh
   and the trial is running.
5. **Test cases** (below) and a short screen-recording walkthrough.
6. Countries: the same as the App Store (United States and Canada) or wider.

### Test cases

Positive (run as the review account after Reset sample classes):

| Prompt | Expected |
| --- | --- |
| What do I have due this week in Campus OS? | Calls get_upcoming_work; lists the sample assignments due in the next 7 days with their classes and due times, e.g. Calculus I's Homework 3.3: Chain rule. |
| When is my Calculus exam and where? | Calls get_upcoming_work or get_class; Exam 2 for Calculus I, with its date and Engineering 102. |
| Make a study guide for my biology midterm from my Campus OS notes. | Calls list_classes, get_class and get_notes (and course files); a study guide built from Principles of Biology's notes, such as enzymes and activation energy. |
| What are the steps left on my rhetorical analysis draft? | Calls get_assignment; the remaining steps of "Rhetorical analysis: rough draft" (thesis and outline, body paragraphs, MLA citations). |
| Find where my notes mention the chain rule. | Calls search_class_content; the Calculus I note "The chain rule" with a snippet. |

Negative:

| Prompt | Expected |
| --- | --- |
| Turn in my chain rule homework. | No tool can submit or change anything; ChatGPT says Campus OS is read-only. |
| What's the weather in Chicago today? | Campus OS tools aren't used. |
| Show me another student's assignments. | Only the signed-in account's data exists to the tools; nothing about anyone else is returned. |

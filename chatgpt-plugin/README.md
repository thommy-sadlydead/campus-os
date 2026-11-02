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

1. **Campus OS's own domain**: the plugin lives at `https://app.campus-os.net`
   (`APP_URL` in Vercel, DNS at Squarespace). OpenAI never lets a published
   plugin's MCP address change, so keep this domain. The old `vercel.app`
   address keeps working for the iPhone app.
2. **Every URL in `plugin.json` and `mcp.json`** uses that domain.
3. **Test it privately in your own ChatGPT**: chatgpt.com/plugins → the plus
   button → **Add custom MCP server**, with the URL `https://app.campus-os.net/mcp` and
   OAuth, then **Create as a plugin**. In a new chat, type `@`, pick Campus OS,
   sign in, tap Allow, and try the test prompts below. After changing a tool,
   open it at chatgpt.com/plugins and select **Refresh**.
4. **Verify yourself with OpenAI**: platform.openai.com → Settings →
   Organization → General → individual verification (to publish under your
   own name).

## Submitting

1. platform.openai.com → Plugins → create a plugin and upload this folder
   as a ZIP (`plugin.json`, `mcp.json` and `assets/`). The metadata can only
   change by uploading a new ZIP. Its `category` is "Productivity": the
   portal rejected "Education" as unknown even though its own list has it.
2. **Domain verification**: on the plugin's MCPs tab, Reconnect shows a
   token. Put it in Vercel as `OPENAI_APPS_CHALLENGE` and redeploy; Campus OS
   serves it at `/.well-known/openai-apps-challenge`. Then Verify Domain.
3. **Connect and scan**: Connect signs in to Campus OS, and OpenAI keeps
   that account for its review scans, so use the review account ("Not you?"
   on the consent page if the browser is signed in as someone else). Then
   Rescan. Every tool is read-only: `readOnlyHint: true`,
   `destructiveHint: false`, `openWorldHint: false` (it only reads the
   signed-in student's own account).
4. **Review details** (private to reviewers): the App Store review account
   (`reecebroderick12@gmail.com` and its password). It has no two-factor
   login, and as a demo account (`DEMO_ACCOUNT_EMAILS`) its trial never runs
   out. Tap Account → Reset sample classes just before submitting so the
   sample due dates are fresh.
5. **Test cases** are in `plugin.json` (`review.test_cases`: 5 positive, 3
   negative). Run the positive ones as the review account before submitting.
   Add a short screen-recording walkthrough under Supporting content.
6. Countries: the same as the App Store (United States and Canada) or wider.
7. **Submit for review** and confirm the policy attestations.

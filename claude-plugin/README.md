# Campus OS for Claude

The Campus OS connector for Claude (claude.ai, the Claude desktop app and the
Claude mobile apps): a student adds Campus OS, signs in with their Campus OS
account, and Claude can read their classes, assignments, exams, notes,
lecture notes and course files (never change them). It's the same server as
the ChatGPT plugin (`chatgpt-plugin/`): one MCP endpoint, one OAuth server,
the same eight read-only tools.

Anthropic has no manifest or package for a remote connector: the directory
listing is the server URL plus what's typed into the submission portal. This
folder holds that copy (`listing.md`) and the logo (`assets/`, the same
black-and-white PNGs as the ChatGPT plugin; brand color #0A0A0A).

## How it works on the website

- **Sign in with Campus OS** (`src/lib/oauth/`): Claude identifies itself
  with its Client ID Metadata Document,
  `https://claude.ai/oauth/mcp-oauth-client-metadata`, whose only redirect
  URI is `https://claude.ai/api/mcp/auth_callback`. Campus OS allows that
  document by its exact URL (`CLAUDE_CLIENT_ID` in `oauth.ts`), not every
  document on claude.ai, and keeps a copy in `KNOWN_CLIENTS` in case
  claude.ai turns away the server's fetch. Claude picks CIMD over dynamic
  client registration because the authorization server metadata advertises
  `client_id_metadata_document_supported` with auth method `none`; Campus OS
  has no registration endpoint. PKCE S256, `iss` on every authorization
  response, and tokens bound to `https://app.campus-os.net/mcp` are the same
  as for ChatGPT.
- **The consent page** (`src/app/oauth/authorize`) shows "Claude (claude.ai)"
  and says what it reads goes to Anthropic, as Anthropic's guidelines ask
  (name the client_id's host, since the document's name is self-asserted).
- **Starting sign-in** (`src/app/mcp/route.ts`): connecting and listing the
  tools need no token. A tool call without one gets HTTP 401 with
  `WWW-Authenticate: Bearer resource_metadata=…, scope="campus.read"`. That's
  what makes Claude show its sign-in prompt; it then retries the same call
  with the new token. (Claude ignores a challenge inside a 200 response,
  which is what ChatGPT uses. ChatGPT's tool calls carry `openai/*` hints in
  `_meta`, and only those still get the challenge in the tool result.)
- **Not supported:** Claude Code. Its client document
  (`https://claude.ai/oauth/claude-code-client-metadata`) uses loopback
  redirect URIs on any port, which Campus OS doesn't allow; it gets "This app
  can't connect to Campus OS."
- **Account → ChatGPT and Claude** (always shown) tells students how to add
  Campus OS to either app, with the address to copy, and lists what's
  connected with a Disconnect button. Changing or resetting the password disconnects it too. The privacy
  policy (`src/app/privacy`) has a Claude section.

## Testing locally

`scripts/check-mcp.mjs` runs the whole flow against a local dev server, as
ChatGPT's stand-in and then as Claude, with Claude's real client document
(the dev server fetches it from claude.ai) and redirect URI. The browser's
redirect to claude.ai is caught in headless Chrome and never sent. It checks
the 401 that starts Claude's sign-in, the consent page's wording, code,
state and `iss` on Claude's callback, the token exchange and refresh, a tool
call with Claude's token, and that a different claude.ai redirect URI and
Claude Code's document are both refused.

1. Make sure `.env` points at the local database, not production:
   `grep ^DATABASE_URL .env | sed -E 's#//[^@]*@#//***@#'` should show
   `127.0.0.1:55432`. Seed it if it's empty: `npm run db:seed`.
2. Start the dev server: `LMS_ALLOW_LOCAL_URLS=1 npx next dev -p 3100`.
3. Log headless Chrome in: `node scripts/connect-videos/login.mjs`.
4. Run `node scripts/check-mcp.mjs`. It ends with "All checks passed".

Claude itself can't reach a local server (it needs a public HTTPS address on
port 443), so the real test happens after deploying.

## After deploying: test it in your own Claude

The website changes reach `https://app.campus-os.net` with the next push to
`master`. Then:

1. **ChatGPT still connects.** The MCP route now answers signed-out tool
   calls that don't carry ChatGPT's `openai/*` hints with a 401, so check
   ChatGPT once: remove Campus OS in ChatGPT, add it again as in
   `chatgpt-plugin/README.md` (Before submitting, step 3), and make sure
   sign-in still starts and the test prompts work.
2. **Add Campus OS to Claude** (Pro or Max): claude.ai → Customize →
   Connectors → **+ Add** → **Add custom connector**. Name: Campus OS. URL:
   `https://app.campus-os.net/mcp` (exactly that: no trailing slash).
   - **Authentication:** "Sign in now" (or "Sign in when needed": the server
     supports both).
   - **OAuth client:** "Use Claude's published identity (Recommended)". Not
     "Register automatically" (Campus OS has no registration endpoint) and
     not "Use your own OAuth client".
   - On a Team or Enterprise plan, an Owner adds it under the organization's
     connectors, and each member then taps **Connect**.
3. **Sign in.** The Campus OS consent page should read "Connect Claude" and
   "Claude (claude.ai) is asking to read your Campus OS account". Tap Allow.
   In Campus OS, Account → ChatGPT and Claude should now list Claude.
4. **Try it.** In a new chat, check the Campus OS connector is on (the tools
   menu under the message box), then run the five prompts in `listing.md`
   (Use cases). Under the connector's tool permissions, every tool should be
   read-only.
5. **If sign-in fails**, Claude's error page shows a reference like
   `ofid_…`. Check Vercel's logs for `/oauth/authorize`, `/oauth/token` and
   `/mcp` at that time, and see
   https://claude.com/docs/connectors/building/troubleshooting. Anthropic's
   requests come from `160.79.104.0/21`; nothing in front of the site may
   block them.
6. Optional: MCP Inspector lists the tools from a terminal:
   `npx @modelcontextprotocol/inspector --cli https://app.campus-os.net/mcp --transport http --method tools/list`

## Submitting to the Connectors Directory

Do this only after the steps above work. Submitting needs a paid Claude plan
(a Free account can't).

1. **Review account:** use the App Store review account (the one in
   `chatgpt-plugin/README.md`), not a real student. Tap Account → Reset
   sample classes just before submitting and again before any hands-on
   review, so the sample due dates are fresh. As a demo account
   (`DEMO_ACCOUNT_EMAILS`) its trial never runs out.
2. **Run the use cases** in `listing.md` as the review account in your own
   Claude (a custom connector, as above). The portal asks you to confirm
   every tool was run.
3. Open **claude.ai/directory/manage** → **Submit new** → **MCP connector**,
   and fill in each step from `listing.md`: Connection, Tools (synced from
   the server; all have titles and read-only annotations), Listing, Use
   cases, Company, Authentication, Data handling, Test & launch, Compliance
   (seven acknowledgments), then Review and submit.
4. **Don't put the review account's password in the portal.** New listings
   are scanned and published as "Community". If Anthropic reviews it by hand
   for "Verified", a reviewer emails for test access; send the review
   account's login then.
5. The **URL slug** (`campus-os`) can't change once published, and neither
   should the server URL: keep `app.campus-os.net`.
6. **Once it's listed**, put its directory page in Vercel as
   `CLAUDE_CONNECTOR_URL` and redeploy. Account → ChatGPT and Claude then
   shows an "Open in Claude" button instead of the custom-connector steps.
   (`CHATGPT_PLUGIN_URL` does the same for ChatGPT.)

After a tool changes, the listing picks up the new definitions when the
portal re-syncs the tools; keep `listing.md`, the consent page's list
(`src/app/oauth/authorize/page.tsx`) and the privacy policy in step with
`src/lib/mcp/tool-defs.ts`.

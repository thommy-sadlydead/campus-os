// node scripts/check-mcp.mjs
//
// End-to-end check of the ChatGPT and Claude plugins against a LOCAL dev
// server: plays the app's part (a client metadata document on
// localhost:4100), signs in through "Sign in with Campus OS" in headless
// Chrome as the seed account, exchanges and refreshes tokens, calls every MCP
// tool in both protocol eras, and checks each result against the tool's
// outputSchema. Then it signs in again as Claude, with Claude's real client
// metadata document (the dev server fetches it from claude.ai) and redirect
// URI: the browser's redirect to claude.ai is caught here and never sent.
//
// Setup: the dev server on port 3100 against a local database (never
// production) with LMS_ALLOW_LOCAL_URLS=1 (so it can read the localhost
// client document), the seed data in it, and headless Chrome logged in:
// node scripts/connect-videos/login.mjs
import http from "node:http";
import crypto from "node:crypto";
import { launch, sleep } from "./connect-videos/cdp.mjs";

const BASE = process.env.CONNECT_VIDEOS_URL || "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error(`${BASE} isn't a local dev server`);
const CLIENT_PORT = 4100;
const CLIENT_ID = `http://localhost:${CLIENT_PORT}/client.json`;
const REDIRECT_URI = `http://localhost:${CLIENT_PORT}/callback`;

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`);
  if (!ok) failures++;
};

// --- A minimal JSON Schema check for the keywords the tool schemas use ---
function validate(schema, value, path = "$") {
  const errors = [];
  const types = schema.type ? [].concat(schema.type) : null;
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (types && !types.some((t) => t === typeOf(value) || (t === "number" && typeOf(value) === "integer"))) {
    return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: doesn't match ${schema.pattern}`);
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: missing`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  return errors;
}

// --- ChatGPT's stand-in: client metadata document + redirect target ---
let resolveCallback;
const callback = new Promise((r) => (resolveCallback = r));
const clientServer = http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${CLIENT_PORT}`);
    if (url.pathname === "/client.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ client_id: CLIENT_ID, client_name: "Local test client", redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }));
    } else if (url.pathname === "/callback") {
      resolveCallback(Object.fromEntries(url.searchParams));
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(CLIENT_PORT);

const postJson = async (path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};
const tokenRequest = async (fields) => {
  const res = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  return { status: res.status, body: await res.json() };
};

try {
  // 1. Discovery
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  const prmMcp = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  const RESOURCE = `${BASE}/mcp`;
  check(prm.resource === RESOURCE && prm.authorization_servers?.[0] === as.issuer, "protected resource metadata points at this issuer", prm);
  check(JSON.stringify(prm) === JSON.stringify(prmMcp), "path-suffixed metadata matches");
  check(as.code_challenge_methods_supported?.includes("S256") && as.authorization_response_iss_parameter_supported === true, "authorization server metadata", as);

  // 2. Unauthenticated MCP: tools are listable, calls ask to connect (a 401
  // for Claude and other clients, a challenge in the result for ChatGPT)
  const init = await postJson("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "check", version: "1" } } });
  check(init.status === 200 && init.body.result.protocolVersion === "2025-11-25", "legacy initialize", init.body);
  const list = await postJson("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = list.body?.result?.tools ?? [];
  check(tools.length === 8, `tools/list without signing in (${tools.length} tools)`);
  const anon = await postJson("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_classes", arguments: {} } });
  const anonChallenge = anon.headers.get("www-authenticate") ?? "";
  check(
    anon.status === 401 && anonChallenge.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`) && anonChallenge.includes('scope="campus.read"'),
    "unauthenticated call gets 401 + WWW-Authenticate (what makes Claude sign in)",
    { status: anon.status, challenge: anonChallenge, body: anon.body }
  );
  const anonChatGpt = await postJson("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_classes", arguments: {}, _meta: { "openai/locale": "en-US" } } });
  const challenge = anonChatGpt.body?.result?._meta?.["mcp/www_authenticate"]?.[0] ?? "";
  check(anonChatGpt.status === 200 && anonChatGpt.body?.result?.isError === true && challenge.includes("resource_metadata="), "ChatGPT's unauthenticated call gets its challenge in _meta", anonChatGpt.body);
  const claudeOrigin = await postJson("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list" }, { Origin: "https://claude.ai" });
  const evilOrigin = await postJson("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list" }, { Origin: "https://evil.example.com" });
  check(claudeOrigin.status === 200 && evilOrigin.status === 403, "Origin: claude.ai is allowed, another site isn't", [claudeOrigin.status, evilOrigin.status]);
  const bad = await postJson("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/list" }, { Authorization: "Bearer nope" });
  check(bad.status === 401 && (bad.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'), "a bad token gets 401 + WWW-Authenticate");

  // 3. Sign in and Allow, in headless Chrome
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challengeS256 = crypto.createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: "state-123",
    code_challenge: challengeS256,
    code_challenge_method: "S256",
    scope: "campus.read",
    resource: RESOURCE,
  })) authorize.searchParams.set(k, v);
  const page = await launch();
  await page.goto(authorize.toString());
  await sleep(2500);
  const consent = await page.eval("document.body.innerText");
  check(/Connect Local test client/.test(consent) && /will be able to see/.test(consent), "consent page shows the app and what it can see", consent.slice(0, 300));
  await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Allow").click(), true`);
  const cb = await Promise.race([callback, sleep(15000).then(() => null)]);
  await page.close();
  check(cb && cb.code && cb.state === "state-123" && cb.iss === as.issuer, "Allow returns code, state and iss", cb);
  if (!cb?.code) throw new Error("No authorization code; stopping.");

  // 4. Tokens
  const wrongVerifier = await tokenRequest({ grant_type: "authorization_code", code: cb.code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: "x".repeat(43), resource: RESOURCE });
  check(wrongVerifier.status === 400 && wrongVerifier.body.error === "invalid_grant", "a wrong PKCE verifier is refused");
  // The failed attempt above didn't use up the code, so the real exchange still works.
  const exchanged = await tokenRequest({ grant_type: "authorization_code", code: cb.code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier, resource: RESOURCE });
  check(exchanged.status === 200 && exchanged.body.access_token && exchanged.body.refresh_token, "code exchange", exchanged.body);
  const replay = await tokenRequest({ grant_type: "authorization_code", code: cb.code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier });
  check(replay.status === 400, "a code works once");
  // Replaying the code revoked that grant (someone else has the code), so connect again for the rest.
  const stillOk = await postJson("/mcp", { jsonrpc: "2.0", id: 5, method: "tools/list" }, { Authorization: `Bearer ${exchanged.body.access_token}` });
  check(stillOk.status === 401, "replaying a code disconnects that grant");

  const page2 = await launch();
  const authorize2 = new URL(authorize);
  const verifier2 = crypto.randomBytes(48).toString("base64url");
  authorize2.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier2).digest("base64url"));
  let resolve2;
  const callback2 = new Promise((r) => (resolve2 = r));
  resolveCallback = resolve2;
  await page2.goto(authorize2.toString());
  await sleep(2000);
  await page2.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Allow").click(), true`);
  const cb2 = await Promise.race([callback2, sleep(15000).then(() => null)]);
  await page2.close();
  const tokens = (await tokenRequest({ grant_type: "authorization_code", code: cb2.code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier2, resource: RESOURCE })).body;
  check(Boolean(tokens.access_token), "connect again");

  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT_ID, resource: RESOURCE });
  check(refreshed.status === 200 && refreshed.body.refresh_token !== tokens.refresh_token, "refresh rotates the refresh token");
  const reused = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT_ID });
  check(reused.status === 400, "a used refresh token is refused");
  const auth = { Authorization: `Bearer ${refreshed.body.access_token}` };

  // 5. Every tool, checked against its outputSchema
  const schemaFor = Object.fromEntries(tools.map((t) => [t.name, t.outputSchema]));
  let callId = 10;
  const call = async (name, args = {}, era = "legacy") => {
    const id = callId++;
    const res =
      era === "modern"
        ? await postJson(
            "/mcp",
            { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } },
            { ...auth, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": name }
          )
        : await postJson("/mcp", { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, auth);
    const result = res.body?.result;
    if (!result || result.isError) {
      check(false, `${name} (${era})`, res.body);
      return null;
    }
    const errors = validate(schemaFor[name], result.structuredContent);
    check(errors.length === 0, `${name} (${era}) matches its outputSchema`, errors.slice(0, 5).join("; "));
    check(JSON.stringify(JSON.parse(result.content[0].text)) === JSON.stringify(result.structuredContent), `${name} text mirrors structuredContent`);
    return result.structuredContent;
  };

  const profile = await call("get_profile");
  const profileAgain = await call("get_profile", {}, "modern");
  check(profile?.id && profile.id === profileAgain?.id, "profile id is stable");
  const classes = await call("list_classes");
  check(classes?.classes?.length > 0, `list_classes found ${classes?.classes?.length ?? 0} classes`);
  await call("get_upcoming_work", { days_ahead: 30 });
  await call("get_upcoming_work", { include_done: true, include_overdue: false }, "modern");
  const klass = classes?.classes?.[0];
  const overview = klass ? await call("get_class", { class_id: klass.id }) : null;
  if (klass) await call("get_notes", { class_id: klass.id });
  const assignment = overview?.assignments?.[0];
  if (assignment) await call("get_assignment", { assignment_id: assignment.id });
  const file = classes?.classes?.length
    ? (await Promise.all(classes.classes.map((c) => call("get_class", { class_id: c.id })))).flatMap((o) => o?.course_files ?? [])[0]
    : null;
  if (file) await call("get_course_material", { material_id: file.id });
  else console.log("- no course files in the seed data; get_course_material not exercised");
  const word = (klass?.name ?? "the").split(/\s+/)[0];
  const found = await call("search_class_content", { query: word }, "modern");
  console.log(`- search for "${word}" found ${found?.results?.length ?? 0} results`);

  const foreign = await postJson("/mcp", { jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "get_class", arguments: { class_id: "not-mine" } } }, auth);
  check(foreign.body?.result?.isError === true && /isn't in this Campus OS account/.test(foreign.body.result.content[0].text), "another account's id reads as not found");
  const invalid = await postJson("/mcp", { jsonrpc: "2.0", id: 100, method: "tools/call", params: { name: "get_upcoming_work", arguments: { days_ahead: 0 } } }, auth);
  check(invalid.body?.result?.isError === true, "invalid arguments come back as a tool error");

  // 6. Claude: its real client metadata document and redirect URI
  const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
  const claudeVerifier = crypto.randomBytes(48).toString("base64url");
  const claudeAuthorize = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT_URI,
    state: "claude-state",
    code_challenge: crypto.createHash("sha256").update(claudeVerifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "campus.read",
    resource: RESOURCE,
  })) claudeAuthorize.searchParams.set(k, v);
  const claudePage = await launch();
  let sentToClaude = null;
  await claudePage.block("https://claude.ai/*", (url) => (sentToClaude ??= url));
  await claudePage.goto(claudeAuthorize.toString());
  await sleep(2500);
  const claudeConsent = await claudePage.eval("document.body.innerText");
  check(
    /Connect Claude/.test(claudeConsent) && /Claude \(claude\.ai\) is asking/.test(claudeConsent) && /goes to Claude \(Anthropic\)/.test(claudeConsent),
    "consent page names Claude, its host and Anthropic",
    claudeConsent.slice(0, 600)
  );
  await claudePage.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Allow").click(), true`);
  for (let i = 0; i < 30 && !sentToClaude; i++) await sleep(500);
  await claudePage.close();
  const claudeCb = sentToClaude ? new URL(sentToClaude) : null;
  check(
    claudeCb && claudeCb.origin + claudeCb.pathname === CLAUDE_REDIRECT_URI && claudeCb.searchParams.get("code") && claudeCb.searchParams.get("state") === "claude-state" && claudeCb.searchParams.get("iss") === as.issuer,
    "Allow sends Claude's callback code, state and iss",
    sentToClaude
  );
  if (!claudeCb?.searchParams.get("code")) throw new Error("No authorization code for Claude; stopping.");
  const claudeTokens = await tokenRequest({
    grant_type: "authorization_code",
    code: claudeCb.searchParams.get("code"),
    redirect_uri: CLAUDE_REDIRECT_URI,
    client_id: CLAUDE_CLIENT_ID,
    code_verifier: claudeVerifier,
    resource: RESOURCE,
  });
  check(claudeTokens.status === 200 && claudeTokens.body.access_token && claudeTokens.body.refresh_token && claudeTokens.body.scope === "campus.read", "Claude's code exchange", claudeTokens.body);
  const claudeRefreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: claudeTokens.body.refresh_token, client_id: CLAUDE_CLIENT_ID, resource: RESOURCE });
  check(claudeRefreshed.status === 200 && claudeRefreshed.body.refresh_token !== claudeTokens.body.refresh_token, "Claude's refresh rotates the refresh token");
  const asChatGpt = await tokenRequest({ grant_type: "refresh_token", refresh_token: claudeRefreshed.body.refresh_token, client_id: "https://chatgpt.com/oauth/client.json" });
  check(asChatGpt.status === 400 && asChatGpt.body.error === "invalid_grant", "Claude's refresh token doesn't work for another client");
  // The call Claude retries after signing in, now with its token.
  const claudeAuth = { Authorization: `Bearer ${claudeRefreshed.body.access_token}` };
  const claudeCall = await postJson("/mcp", { jsonrpc: "2.0", id: 200, method: "tools/call", params: { name: "list_classes", arguments: {} } }, claudeAuth);
  check(claudeCall.status === 200 && !claudeCall.body?.result?.isError && claudeCall.body?.result?.structuredContent?.classes?.length > 0, "Claude's token reads the account", claudeCall.body);
  const claudeProfile = await postJson("/mcp", { jsonrpc: "2.0", id: 201, method: "tools/call", params: { name: "get_profile", arguments: {} } }, claudeAuth);
  check(claudeProfile.body?.result?.structuredContent?.id === profile?.id, "same profile id through Claude as through the other app");

  // Requests Claude's flow must refuse: another redirect URI, and Claude Code's document.
  const refused = async (overrides, label, expected) => {
    const url = new URL(claudeAuthorize);
    for (const [k, v] of Object.entries(overrides)) url.searchParams.set(k, v);
    const p = await launch();
    let leaked = null;
    await p.block("https://claude.ai/*", (u) => (leaked ??= u));
    await p.goto(url.toString());
    await sleep(2000);
    const text = await p.eval("document.body.innerText");
    await p.close();
    check(expected.test(text) && !leaked, label, text.slice(0, 200));
  };
  await refused({ redirect_uri: "https://claude.ai/api/mcp/other_callback" }, "a different claude.ai redirect URI is refused", /doesn't match the app/);
  await refused(
    { client_id: "https://claude.ai/oauth/claude-code-client-metadata", redirect_uri: "http://localhost:5599/callback" },
    "Claude Code's client document is refused",
    /can't connect to Campus OS/
  );
} catch (err) {
  console.error(err);
  failures++;
} finally {
  clientServer.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);

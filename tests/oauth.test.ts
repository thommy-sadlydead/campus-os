import { describe, expect, it } from "vitest";
import {
  KNOWN_CLIENTS,
  OAUTH_SCOPE,
  authorizationResponseUrl,
  authorizationServerMetadata,
  bearerChallenge,
  checkAuthorizeParams,
  isAllowedClientId,
  isValidCodeVerifier,
  mcpResource,
  parseClientMetadata,
  pkceChallenge,
  pkceMatches,
  profileIdFor,
  protectedResourceMetadata,
  readAuthorizeParams,
  safeNextPath,
} from "../src/lib/oauth/oauth";

const ORIGIN = "https://campus.example.com";
const CHATGPT = "https://chatgpt.com/oauth/client.json";

// RFC 7636 Appendix B's example.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function params(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    response_type: "code",
    client_id: CHATGPT,
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    state: "abc",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: OAUTH_SCOPE,
    resource: mcpResource(ORIGIN),
    ...overrides,
  };
  return readAuthorizeParams((key) => base[key]);
}

describe("PKCE", () => {
  it("matches RFC 7636's example", () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses a wrong or malformed verifier", () => {
    expect(pkceMatches(VERIFIER.replace("d", "e"), CHALLENGE)).toBe(false);
    expect(pkceMatches("short", pkceChallenge("short"))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${"a".repeat(42)}!`)).toBe(false);
  });
});

describe("which apps can sign students in", () => {
  it("allows ChatGPT's client metadata documents", () => {
    expect(isAllowedClientId(CHATGPT)).toBe(true);
    expect(isAllowedClientId("https://chatgpt.com/oauth/abc123/client.json")).toBe(true);
  });

  it("refuses other sites, plain http, the bare host, credentials and fragments", () => {
    expect(isAllowedClientId("https://evil.example.com/client.json")).toBe(false);
    expect(isAllowedClientId("https://chatgpt.com.evil.com/client.json")).toBe(false);
    expect(isAllowedClientId("http://chatgpt.com/oauth/client.json")).toBe(false);
    expect(isAllowedClientId("https://chatgpt.com/")).toBe(false);
    expect(isAllowedClientId("https://user:pw@chatgpt.com/oauth/client.json")).toBe(false);
    expect(isAllowedClientId("https://chatgpt.com/oauth/client.json#x")).toBe(false);
    expect(isAllowedClientId("not a url")).toBe(false);
  });

  it("only allows a localhost client for local testing", () => {
    expect(isAllowedClientId("http://localhost:4000/client.json")).toBe(false);
    expect(isAllowedClientId("http://localhost:4000/client.json", { allowLocal: true })).toBe(true);
  });

  it("reads a client metadata document only when it describes that client_id", () => {
    const doc = {
      client_id: CHATGPT,
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    };
    expect(parseClientMetadata(doc, CHATGPT)).toEqual(KNOWN_CLIENTS[CHATGPT]);
    expect(parseClientMetadata({ ...doc, client_id: "https://chatgpt.com/other.json" }, CHATGPT)).toBeNull();
    expect(parseClientMetadata({ ...doc, redirect_uris: [] }, CHATGPT)).toBeNull();
    expect(parseClientMetadata("nope", CHATGPT)).toBeNull();
  });
});

describe("authorization requests", () => {
  it("grants the one scope for a well-formed request", () => {
    expect(checkAuthorizeParams(params(), mcpResource(ORIGIN))).toEqual({ scope: OAUTH_SCOPE, resource: mcpResource(ORIGIN) });
    // No scope or resource asked for: the defaults.
    expect(checkAuthorizeParams(params({ scope: null, resource: null }), mcpResource(ORIGIN))).toEqual({
      scope: OAUTH_SCOPE,
      resource: mcpResource(ORIGIN),
    });
  });

  it("requires PKCE with S256", () => {
    expect(checkAuthorizeParams(params({ code_challenge: null }), mcpResource(ORIGIN))).toMatchObject({ error: "invalid_request" });
    expect(checkAuthorizeParams(params({ code_challenge_method: "plain" }), mcpResource(ORIGIN))).toMatchObject({ error: "invalid_request" });
    expect(checkAuthorizeParams(params({ code_challenge: "too-short" }), mcpResource(ORIGIN))).toMatchObject({ error: "invalid_request" });
  });

  it("refuses other response types and other resources", () => {
    expect(checkAuthorizeParams(params({ response_type: "token" }), mcpResource(ORIGIN))).toMatchObject({ error: "unsupported_response_type" });
    expect(checkAuthorizeParams(params({ resource: "https://evil.example.com/mcp" }), mcpResource(ORIGIN))).toMatchObject({ error: "invalid_target" });
  });

  it("sends code, state and iss back to the redirect URI", () => {
    const url = new URL(authorizationResponseUrl("https://chatgpt.com/cb?keep=1", ORIGIN, "xyz", { code: "c0de" }));
    expect(url.origin + url.pathname).toBe("https://chatgpt.com/cb");
    expect(Object.fromEntries(url.searchParams)).toEqual({ keep: "1", code: "c0de", state: "xyz", iss: ORIGIN });
  });

  it("sends errors back with iss too, and leaves out a missing state", () => {
    const url = new URL(authorizationResponseUrl("https://chatgpt.com/cb", ORIGIN, null, { error: "access_denied", description: "No." }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "access_denied", error_description: "No.", iss: ORIGIN });
  });
});

describe("discovery metadata", () => {
  it("names this site as the issuer everywhere, exactly", () => {
    const as = authorizationServerMetadata(ORIGIN);
    const prm = protectedResourceMetadata(ORIGIN);
    expect(as.issuer).toBe(ORIGIN);
    expect(prm.authorization_servers).toEqual([ORIGIN]);
    expect(prm.resource).toBe(`${ORIGIN}/mcp`);
  });

  it("advertises what ChatGPT requires", () => {
    const as = authorizationServerMetadata(ORIGIN);
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as).not.toHaveProperty("registration_endpoint");
  });

  it("points 401 challenges at the protected resource metadata", () => {
    expect(bearerChallenge(ORIGIN)).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`);
    expect(bearerChallenge(ORIGIN, { code: "invalid_token", description: 'Say "hi"' })).toContain(`error="invalid_token", error_description="Say 'hi'"`);
  });
});

describe("profile ids", () => {
  it("are stable per account, distinct between accounts, and don't contain the account id", () => {
    const a = profileIdFor("user_1", "secret");
    expect(profileIdFor("user_1", "secret")).toBe(a);
    expect(profileIdFor("user_2", "secret")).not.toBe(a);
    expect(a).toMatch(/^cos_[0-9a-f]{24}$/);
    expect(a).not.toContain("user_1");
  });
});

describe("safeNextPath", () => {
  it("allows paths on this site", () => {
    expect(safeNextPath("/oauth/authorize?client_id=x")).toBe("/oauth/authorize?client_id=x");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "/x\r\nSet-Cookie: a", "", null, undefined]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});

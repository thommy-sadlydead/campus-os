import { oauthOrigin, verifyAccessToken } from "@/lib/oauth/oauth-server";
import { bearerChallenge, mcpResource } from "@/lib/oauth/oauth";
import { handleMcpPost, hasOpenAiHints, type McpServer } from "@/lib/mcp/protocol";
import { SERVER_INSTRUCTIONS, TOOLS } from "@/lib/mcp/tool-defs";
import { runTool } from "@/lib/mcp/tools-server";

// The MCP endpoint ChatGPT and Claude talk to (chatgpt-plugin/,
// claude-plugin/). Listing the tools needs no sign-in; calling one needs an
// access token from "Sign in with Campus OS" (src/lib/oauth/). Without one:
// - ChatGPT's tool calls (they carry openai/* hints in _meta) come back as a
//   tool error with a WWW-Authenticate challenge in _meta, which is what
//   makes ChatGPT show its "Connect" button.
// - Everyone else's, Claude's among them, get an HTTP 401 with the
//   challenge: Claude only starts sign-in on a 401 (it ignores a challenge
//   in a 200), then retries the same call with the new token.
// A token that's present but no good gets a 401 from every client, so it's
// refreshed or the student signs in again.

export const maxDuration = 30;

const MAX_BODY_BYTES = 1024 * 1024;

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", ...extra },
  });
}

/**
 * DNS-rebinding protection from the MCP spec: a request that carries an
 * Origin header must come from this site, ChatGPT or Claude. Server-to-server
 * requests (ChatGPT's own) carry none.
 */
const APP_ORIGINS = ["https://chatgpt.com", "https://claude.ai"];

function originAllowed(request: Request, origin: string): boolean {
  const from = request.headers.get("origin");
  if (!from) return true;
  if (from === origin || APP_ORIGINS.includes(from)) return true;
  return process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(from);
}

export async function POST(request: Request) {
  const origin = await oauthOrigin();
  if (!origin) return json(503, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "APP_URL isn't set" } });
  if (!originAllowed(request, origin)) return json(403, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Origin not allowed" } });

  const authHeader = request.headers.get("authorization");
  let userId: string | null = null;
  if (authHeader) {
    const token = /^Bearer\s+(\S+)$/i.exec(authHeader)?.[1] ?? "";
    const verified = await verifyAccessToken(token, mcpResource(origin));
    if (!verified) {
      return json(
        401,
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "The access token is invalid or has expired." } },
        { "WWW-Authenticate": bearerChallenge(origin, { code: "invalid_token", description: "The access token is invalid or has expired." }) }
      );
    }
    userId = verified.userId;
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } });

  const server: McpServer = {
    instructions: SERVER_INSTRUCTIONS,
    tools: TOOLS,
    challengeToolCall(params) {
      if (userId || hasOpenAiHints(params)) return null;
      return bearerChallenge(origin);
    },
    async callTool(name, args) {
      if (!userId) {
        const description = "Connect your Campus OS account to continue.";
        return {
          isError: true,
          content: [{ type: "text", text: "Authentication required: connect your Campus OS account." }],
          _meta: { "mcp/www_authenticate": [bearerChallenge(origin, { code: "invalid_token", description })] },
        };
      }
      return runTool(userId, name, args);
    },
  };

  const res = await handleMcpPost(request.headers, raw, server);
  return json(res.status, res.body, res.headers);
}

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

// No server-initiated streams and no sessions, so GET and DELETE aren't offered.
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

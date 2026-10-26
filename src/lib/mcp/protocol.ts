// The Model Context Protocol over Streamable HTTP, for the MCP endpoint
// (src/app/mcp): JSON-RPC in, one JSON response out, no sessions and no
// streams (every tool here answers in one go). Pure, so tests/mcp.test.ts
// can drive it without a server.
//
// It's dual-era (modelcontextprotocol.io/specification/2026-07-28/basic/versioning):
// - Legacy clients (2025-11-25 and earlier) open with `initialize` and get
//   the version they asked for when it's one of LEGACY_VERSIONS.
// - Modern clients (2026-07-28) skip the handshake and put the version in
//   every request's _meta, mirrored in the MCP-Protocol-Version, Mcp-Method
//   and Mcp-Name headers, which must match the body.

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "campus-os", title: "Campus OS", version: "1.0.0" };

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface McpServer {
  instructions: string;
  tools: object[];
  callTool(name: string, args: unknown): Promise<ToolCallResult>;
}

export interface McpHttpResponse {
  status: number;
  /** A JSON-RPC response; absent for 202 Accepted. */
  body?: Record<string, unknown>;
}

type Id = string | number | null;

const rpcError = (status: number, id: Id, code: number, message: string, data?: unknown): McpHttpResponse => ({
  status,
  body: { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } },
});

/** Reads a header value that may use the `=?base64?…?=` sentinel encoding. */
export function decodeHeaderValue(value: string): string {
  const m = /^=\?base64\?(.*)\?=$/.exec(value);
  return m ? Buffer.from(m[1], "base64").toString("utf8") : value;
}

export async function handleMcpPost(headers: { get(name: string): string | null }, rawBody: string, server: McpServer): Promise<McpHttpResponse> {
  let msg: unknown;
  try {
    msg = JSON.parse(rawBody);
  } catch {
    return rpcError(400, null, -32700, "Parse error");
  }
  if (Array.isArray(msg)) return rpcError(400, null, -32600, "Batched requests aren't supported");
  if (!msg || typeof msg !== "object") return rpcError(400, null, -32600, "Invalid request");
  const m = msg as Record<string, unknown>;
  const method = typeof m.method === "string" ? m.method : null;
  const hasId = "id" in m && (typeof m.id === "string" || typeof m.id === "number");
  const id: Id = hasId ? (m.id as string | number) : null;
  if (m.jsonrpc !== "2.0" || !method) {
    // A JSON-RPC response from the client (or junk): nothing to answer.
    return rpcError(400, id, -32600, "Invalid request");
  }

  // Notifications (no id) are acknowledged and ignored: nothing here needs them.
  if (!hasId) return { status: 202 };

  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  const meta = (params._meta && typeof params._meta === "object" ? params._meta : {}) as Record<string, unknown>;
  const requested = typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : null;
  const modern = requested !== null && method !== "initialize";

  if (modern) {
    if (!MODERN_VERSIONS.includes(requested)) {
      return rpcError(400, id, -32022, "Unsupported protocol version", {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        requested,
      });
    }
    const mismatch = (header: string, expected: string) => {
      const value = headers.get(header);
      if (value === null) return `Missing ${header} header`;
      return decodeHeaderValue(value) === expected ? null : `Header mismatch: ${header} doesn't match the request body`;
    };
    const problem =
      mismatch("mcp-protocol-version", requested) ??
      mismatch("mcp-method", method) ??
      (method === "tools/call" && typeof params.name === "string" ? mismatch("mcp-name", params.name) : null);
    if (problem) return rpcError(400, id, -32020, problem);
  }

  const result = (body: Record<string, unknown>): McpHttpResponse => ({
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "complete",
        ...body,
        ...(modern ? { _meta: { ...((body._meta as object) ?? {}), [META_SERVER_INFO]: SERVER_INFO } } : {}),
      },
    },
  });

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result({
        protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: server.instructions,
      });
    }
    case "server/discover":
      return result({
        supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        capabilities: { tools: {} },
        instructions: server.instructions,
        ttlMs: 3_600_000,
        cacheScope: "public",
      });
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: server.tools, ttlMs: 300_000, cacheScope: "public" });
    case "tools/call": {
      if (typeof params.name !== "string") return rpcError(modern ? 400 : 200, id, -32602, "Missing tool name");
      const toolResult = await server.callTool(params.name, params.arguments);
      return result({ ...toolResult });
    }
    default:
      return rpcError(modern ? 404 : 200, id, -32601, `Method not found: ${method}`);
  }
}

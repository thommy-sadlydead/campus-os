import { describe, expect, it, vi } from "vitest";
import { handleMcpPost, LEGACY_VERSIONS, MODERN_VERSIONS, SERVER_INFO, type McpServer } from "../src/lib/mcp/protocol";
import {
  PROFILE_OUTPUT_SCHEMA,
  SERVER_INSTRUCTIONS,
  TOOL_INPUTS,
  TOOLS,
  meetingFor,
  minuteLabel,
  snippetAround,
  takeWithinBudget,
} from "../src/lib/mcp/tool-defs";
import { OAUTH_SCOPE } from "../src/lib/oauth/oauth";

function headers(values: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

function fakeServer() {
  const callTool = vi.fn(async (name: string, args: unknown) => ({
    content: [{ type: "text" as const, text: "ok" }],
    structuredContent: { name, args },
  }));
  const server: McpServer = { instructions: SERVER_INSTRUCTIONS, tools: TOOLS, callTool };
  return { server, callTool };
}

const MODERN = MODERN_VERSIONS[0];

/** A modern (2026-07-28) request with matching headers. */
function modern(method: string, params: Record<string, unknown> = {}, headerOverrides: Record<string, string | null> = {}) {
  const body = {
    jsonrpc: "2.0",
    id: 7,
    method,
    params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} } },
  };
  const h: Record<string, string> = { "MCP-Protocol-Version": MODERN, "Mcp-Method": method };
  if (typeof params.name === "string") h["Mcp-Name"] = params.name;
  for (const [k, v] of Object.entries(headerOverrides)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  return [headers(h), JSON.stringify(body)] as const;
}

describe("legacy clients (initialize handshake)", () => {
  it("answers initialize with the version asked for when supported", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(
      headers(),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      server
    );
    expect(res.status).toBe(200);
    expect(res.body?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS,
    });
  });

  it("offers its newest legacy version when the one asked for isn't supported", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(headers(), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-01-01" } }), server);
    expect((res.body?.result as { protocolVersion: string }).protocolVersion).toBe(LEGACY_VERSIONS[0]);
  });

  it("accepts notifications with 202 and no body", async () => {
    const { server } = fakeServer();
    expect(await handleMcpPost(headers(), JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), server)).toEqual({ status: 202 });
  });

  it("lists the tools and calls one", async () => {
    const { server, callTool } = fakeServer();
    const list = await handleMcpPost(headers(), JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), server);
    expect((list.body?.result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);

    const call = await handleMcpPost(
      headers(),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_classes", arguments: { include_archived: true } } }),
      server
    );
    expect(callTool).toHaveBeenCalledWith("list_classes", { include_archived: true });
    expect(call.body).toMatchObject({ id: 3, result: { resultType: "complete", structuredContent: { name: "list_classes" } } });
  });

  it("answers an unknown method with -32601", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(headers(), JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/list" }), server);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ error: { code: -32601 } });
  });

  it("rejects bad JSON and batches", async () => {
    const { server } = fakeServer();
    expect((await handleMcpPost(headers(), "{", server)).body).toMatchObject({ error: { code: -32700 } });
    expect((await handleMcpPost(headers(), "[]", server)).status).toBe(400);
  });
});

describe("modern clients (2026-07-28, no handshake)", () => {
  it("answers server/discover with every supported version", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(...modern("server/discover"), server);
    expect(res.status).toBe(200);
    expect(res.body?.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
      capabilities: { tools: {} },
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    });
  });

  it("lists tools with caching hints", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(...modern("tools/list"), server);
    expect(res.body?.result).toMatchObject({ ttlMs: 300_000, cacheScope: "public" });
  });

  it("refuses a version it doesn't speak, naming the ones it does", async () => {
    const { server } = fakeServer();
    const [h] = modern("tools/list", {}, { "MCP-Protocol-Version": "2099-01-01" });
    const res = await handleMcpPost(
      h,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } }),
      server
    );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: -32022, data: { requested: "2099-01-01" } } });
  });

  it("rejects missing or mismatched headers", async () => {
    const { server } = fakeServer();
    expect((await handleMcpPost(...modern("tools/list", {}, { "Mcp-Method": null }), server)).body).toMatchObject({ error: { code: -32020 } });
    const mismatched = await handleMcpPost(...modern("tools/call", { name: "get_class", arguments: {} }, { "Mcp-Name": "list_classes" }), server);
    expect(mismatched.status).toBe(400);
    expect(mismatched.body).toMatchObject({ error: { code: -32020 } });
  });

  it("decodes a Base64-encoded Mcp-Name before comparing", async () => {
    const { server, callTool } = fakeServer();
    const encoded = `=?base64?${Buffer.from("get_class").toString("base64")}?=`;
    const res = await handleMcpPost(...modern("tools/call", { name: "get_class", arguments: { class_id: "c1" } }, { "Mcp-Name": encoded }), server);
    expect(res.status).toBe(200);
    expect(callTool).toHaveBeenCalledWith("get_class", { class_id: "c1" });
  });

  it("answers an unknown method with 404 and -32601", async () => {
    const { server } = fakeServer();
    const res = await handleMcpPost(...modern("prompts/list"), server);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: -32601 } });
  });
});

describe("tool definitions", () => {
  it("has a validator for every tool, and unique names", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_INPUTS).sort());
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("marks every tool read-only, private and OAuth-protected", () => {
    for (const t of TOOLS) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t.securitySchemes).toEqual([{ type: "oauth2", scopes: [OAUTH_SCOPE] }]);
      expect(t._meta.securitySchemes).toEqual(t.securitySchemes);
      expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(t.outputSchema).toMatchObject({ type: "object" });
      expect(t.description.length).toBeGreaterThan(30);
      expect(String(t._meta["openai/toolInvocation/invoking"]).length).toBeLessThanOrEqual(64);
    }
  });

  it("designates exactly one profile tool, with OpenAI's schema", () => {
    const profiles = TOOLS.filter((t) => t._meta["openai/profile"] === true);
    expect(profiles.map((t) => t.name)).toEqual(["get_profile"]);
    expect(profiles[0].outputSchema).toBe(PROFILE_OUTPUT_SCHEMA);
  });

  it("validates inputs strictly", () => {
    expect(TOOL_INPUTS.get_upcoming_work.safeParse({ days_ahead: 0 }).success).toBe(false);
    expect(TOOL_INPUTS.get_upcoming_work.safeParse({ days_ahead: 30, class_id: "c1" }).success).toBe(true);
    expect(TOOL_INPUTS.list_classes.safeParse({ surprise: true }).success).toBe(false);
    expect(TOOL_INPUTS.search_class_content.safeParse({ query: " a " }).success).toBe(false);
    expect(TOOL_INPUTS.get_notes.safeParse({ class_id: "c1", note_ids: Array(21).fill("n") }).success).toBe(false);
  });
});

describe("tool helpers", () => {
  it("formats meeting times", () => {
    expect([0, 540, 750, 1439].map(minuteLabel)).toEqual(["12:00 AM", "9:00 AM", "12:30 PM", "11:59 PM"]);
    expect(meetingFor({ dayOfWeek: 1, startMinute: 540, endMinute: 590, location: "Bio 210", label: "Lecture" })).toEqual({
      day: "Monday",
      start: "9:00 AM",
      end: "9:50 AM",
      location: "Bio 210",
      label: "Lecture",
    });
  });

  it("cuts a snippet around the first match", () => {
    const text = `${"a ".repeat(200)}photosynthesis makes sugar ${"b ".repeat(200)}`;
    const s = snippetAround(text, "Photosynthesis", 20);
    expect(s).toContain("photosynthesis makes sugar");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(snippetAround("short text", "missing")).toBe("short text");
  });

  it("keeps whole items within a budget, always at least one", () => {
    expect(takeWithinBudget([5, 5, 5], (n) => n, 12)).toEqual({ kept: [5, 5], left: [5] });
    expect(takeWithinBudget([50, 5], (n) => n, 10)).toEqual({ kept: [50], left: [5] });
    expect(takeWithinBudget([], (n: number) => n, 10)).toEqual({ kept: [], left: [] });
  });
});

import "server-only";
import { NextResponse } from "next/server";
import { oauthOrigin } from "@/lib/oauth/oauth-server";

// The OAuth discovery documents are public and read by browser-based tools
// too (MCP Inspector), so they allow any origin.
export const METADATA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

export async function metadataResponse(build: (origin: string) => object): Promise<NextResponse> {
  const origin = await oauthOrigin();
  if (!origin) return NextResponse.json({ error: "APP_URL isn't set" }, { status: 503, headers: METADATA_CORS });
  return NextResponse.json(build(origin), { headers: { ...METADATA_CORS, "Cache-Control": "public, max-age=300" } });
}

import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/oauth/oauth";
import { METADATA_CORS, metadataResponse } from "@/lib/oauth/metadata-response";

// RFC 9728 protected resource metadata for the MCP endpoint, at
// /.well-known/oauth-protected-resource and (the path-suffixed form for the
// resource https://<site>/mcp) /.well-known/oauth-protected-resource/mcp.
export function GET() {
  return metadataResponse(protectedResourceMetadata);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS });
}

import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/lib/oauth/oauth";
import { METADATA_CORS, metadataResponse } from "@/lib/oauth/metadata-response";

// RFC 8414 authorization server metadata ("Sign in with Campus OS").
export function GET() {
  return metadataResponse(authorizationServerMetadata);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS });
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createGmailHandoff } from "@/lib/native-oauth";

// The first step of "Connect Gmail" in the iPhone app (see
// src/lib/native-oauth.ts): a start link that carries who's connecting
// into the system sign-in sheet, which doesn't have the app's login.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });

  const url = new URL("/api/email/oauth/start", request.url);
  url.searchParams.set("handoff", createGmailHandoff(user.id));
  return NextResponse.json({ url: url.toString() });
}

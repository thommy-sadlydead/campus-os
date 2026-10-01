import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { openGmailResult } from "@/lib/native-oauth";
import { saveGmailAccount } from "@/lib/gmail-account";

// The last step of "Connect Gmail" in the iPhone app: the app posts back
// the sealed result the sign-in sheet ended with, from its own logged-in
// session, and it's saved only if it was made for this same student (see
// src/lib/native-oauth.ts for why).
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { result?: unknown } | null;
  const result = typeof body?.result === "string" ? openGmailResult(body.result, user.id) : null;
  if (!result) {
    return NextResponse.json(
      { error: "That Gmail connection attempt expired or looked invalid. Try again." },
      { status: 400 }
    );
  }

  await saveGmailAccount(user.id, result.emailAddress, result.tokens);
  return NextResponse.json({ ok: true, emailAddress: result.emailAddress });
}

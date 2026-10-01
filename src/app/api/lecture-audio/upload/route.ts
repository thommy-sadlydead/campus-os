import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { ALLOWED_AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES } from "@/lib/lecture-notes";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit";

// Issues client tokens for the Lectures tab's direct-to-Blob audio upload
// (src/components/classes/LecturesPanel.tsx). Called via fetch() from
// @vercel/blob/client's upload(), not a page navigation, so it uses
// getCurrentUser() and a plain 401 body instead of requireUser()'s redirect.
//
// No onUploadCompleted here: that callback needs a publicly reachable URL,
// which `next dev` doesn't have. The row is created client-side instead,
// right after upload() resolves — see createLectureAction in
// src/app/classes/[id]/lecture-actions.ts.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in to upload audio." }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Backstop for uploads that never become a lecture (the Lectures tab
        // checks the lecture limit before it ever asks for a token).
        if (!(await consumeRateLimit(`upload:${user.id}`, RATE_LIMITS.upload))) {
          throw new Error("You've reached today's audio upload limit. Try again tomorrow.");
        }
        return {
          allowedContentTypes: ALLOWED_AUDIO_CONTENT_TYPES,
          maximumSizeInBytes: MAX_AUDIO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 400 }
    );
  }
}

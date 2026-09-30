import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MATERIAL_UPLOAD_CONTENT_TYPES, MAX_DOCUMENT_FILE_BYTES } from "@/lib/lecture-notes";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit";

// Issues upload tokens for book and slide files too big to send through a
// Server Action (Vercel caps requests to the app at 4.5 MB). The browser
// uploads straight to Blob storage under materials/<classId>/, then
// addClassMaterialFromBlobAction reads the text out and deletes the upload.
// Same shape as /api/lecture-audio/upload.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in to upload files." }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const [folder, classId] = pathname.split("/");
        const owned =
          folder === "materials" &&
          classId &&
          (await prisma.class.findFirst({ where: { id: classId, userId: user.id }, select: { id: true } }));
        if (!owned) throw new Error("That class wasn't found.");
        if (!(await consumeRateLimit(`upload:${user.id}`, RATE_LIMITS.upload))) {
          throw new Error("You've reached today's upload limit. Try again tomorrow.");
        }
        return {
          allowedContentTypes: MATERIAL_UPLOAD_CONTENT_TYPES,
          maximumSizeInBytes: MAX_DOCUMENT_FILE_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}

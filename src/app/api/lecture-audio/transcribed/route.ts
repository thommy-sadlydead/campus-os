import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { advanceLecture, isAuthorizedTranscriptionWebhook } from "@/lib/lecture-pipeline";

// Note generation runs after the response and can take a few minutes.
export const maxDuration = 300;

// AssemblyAI calls this when a transcript finishes (production only; see
// transcriptionWebhook in src/lib/lecture-pipeline.ts), so a lecture's
// notes get written even if nobody has the app open. It answers right
// away and does the work afterwards. The body only says which transcript
// changed; advanceLecture asks AssemblyAI for the actual status rather than
// trusting the request.
export async function POST(request: Request) {
  if (!isAuthorizedTranscriptionWebhook(request.headers)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let transcriptId: unknown;
  try {
    transcriptId = ((await request.json()) as { transcript_id?: unknown }).transcript_id;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (typeof transcriptId !== "string" || !transcriptId) {
    return NextResponse.json({ error: "Missing transcript_id." }, { status: 400 });
  }

  const lecture = await prisma.lecture.findFirst({ where: { assemblyaiId: transcriptId }, select: { id: true } });
  if (lecture) after(() => advanceLecture(lecture.id));
  return NextResponse.json({ ok: true });
}

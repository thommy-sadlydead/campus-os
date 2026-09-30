"use client";

import { upload } from "@vercel/blob/client";
import { checkLectureLimitAction, createLectureAction } from "@/app/classes/[id]/lecture-actions";

// Above this, the upload is split into parts that go up in parallel and are
// retried individually, which matters for hour-long recordings on campus
// Wi-Fi.
const MULTIPART_THRESHOLD_BYTES = 20 * 1024 * 1024;

/**
 * Shared by recording in the app and uploading a file: checks the daily
 * lecture limit, uploads the audio straight to Blob storage (the app's own
 * server never sees the bytes, which also avoids Vercel's 4.5 MB request
 * limit), then creates the lecture, which starts transcription.
 */
export async function saveLectureAudio(
  classId: string,
  file: File,
  title: string,
  onProgress: (percent: number) => void
): Promise<{ error?: string }> {
  const limit = await checkLectureLimitAction();
  if (limit.error) return limit;

  const safeName = file.name.replace(/[^\w.-]+/g, "-");
  const blob = await upload(`lectures/${classId}/${safeName}`, file, {
    access: "public",
    handleUploadUrl: "/api/lecture-audio/upload",
    // Without this, Blob guesses the type from the extension, and a Chrome
    // recording's ".webm" comes out as video/webm, which the audio-only
    // upload token rejects.
    contentType: file.type || undefined,
    multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    onUploadProgress: (event) => onProgress(Math.round(event.percentage)),
  });

  return createLectureAction(classId, { title, audioUrl: blob.url });
}

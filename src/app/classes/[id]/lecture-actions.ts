"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { del } from "@vercel/blob";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { deleteAssemblyAITranscripts } from "@/lib/assemblyai";
import { addLectureToNotes } from "@/lib/lecture-notes-sync";
import { advanceLecture, generateNotes, submitTranscription } from "@/lib/lecture-pipeline";
import { AI_CONSENT_MESSAGE, hasAiConsent } from "@/lib/ai-consent";
import { LECTURE_LIMIT_MESSAGE, RATE_LIMITS, consumeRateLimit, isRateLimited } from "@/lib/rate-limit";
import { MAX_MATERIAL_TITLE_LENGTH, MAX_MATERIAL_CONTENT_LENGTH } from "@/lib/lecture-notes";
import { htmlToReadableText, extractHtmlTitle } from "@/lib/text";
import { classifyCanvasUrl, fetchCanvasFileContent, MAX_DOCUMENT_FILE_BYTES, type CanvasConfig } from "@/lib/canvas";
import { extractDocumentText } from "@/lib/office-text";
import { decryptSecret } from "@/lib/crypto";

async function requireOwnedClass(classId: string, userId: string) {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls || cls.userId !== userId) throw new Error("Not found.");
  return cls;
}

async function requireOwnedLecture(lectureId: string, userId: string) {
  const lecture = await prisma.lecture.findUnique({ where: { id: lectureId }, include: { class: true } });
  if (!lecture || lecture.class.userId !== userId) throw new Error("Not found.");
  return lecture;
}

async function requireOwnedMaterial(materialId: string, userId: string) {
  const material = await prisma.classMaterial.findUnique({ where: { id: materialId }, include: { class: true } });
  if (!material || material.class.userId !== userId) throw new Error("Not found.");
  return material;
}

const createLectureSchema = z.object({
  title: z.string().min(1).max(160),
  audioUrl: z.string().url(),
});

/**
 * Lets the Lectures tab refuse an audio upload up front when the user is
 * already at the daily lecture limit, instead of uploading the whole file
 * and only then being told no. The create actions below enforce the limit
 * for real; this is the courtesy check.
 */
export async function checkLectureLimitAction(): Promise<{ error?: string }> {
  const user = await requireUser();
  // Transcripts (AssemblyAI) and notes (Claude) are AI, so ask before the upload.
  if (!hasAiConsent(user)) return { error: AI_CONSENT_MESSAGE };
  return (await isRateLimited(`lecture:${user.id}`, RATE_LIMITS.lecture)) ? { error: LECTURE_LIMIT_MESSAGE } : {};
}

/**
 * Called by the client right after its direct-to-Blob upload resolves (see
 * src/app/api/lecture-audio/upload/route.ts) — NOT from Vercel Blob's
 * onUploadCompleted webhook, which needs a publicly reachable callback URL
 * that `next dev` doesn't have. Creates the row, then submits the
 * transcription job immediately so the panel can start polling right away.
 */
export async function createLectureAction(
  classId: string,
  input: { title: string; audioUrl: string }
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!hasAiConsent(user)) return { error: AI_CONSENT_MESSAGE };
  await requireOwnedClass(classId, user.id);
  const parsed = createLectureSchema.parse(input);
  if (!(await consumeRateLimit(`lecture:${user.id}`, RATE_LIMITS.lecture))) {
    return { error: LECTURE_LIMIT_MESSAGE };
  }

  const lecture = await prisma.lecture.create({
    data: { classId, title: parsed.title, audioUrl: parsed.audioUrl, status: "UPLOADED" },
  });
  await submitTranscription(lecture.id, parsed.audioUrl);

  revalidatePath(`/classes/${classId}`);
  return {};
}

/**
 * Called on an interval by the Lectures tab for every lecture still in
 * progress. The work runs after the response (see advanceLecture), so a
 * long note-generation step never holds up the page; the next poll picks
 * up the new status. In production AssemblyAI's webhook usually gets there
 * first, and advanceLecture makes sure only one of them writes the notes.
 */
export async function pollLectureStatusAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);
  after(() => advanceLecture(lecture.id));
}

export async function retryLectureAction(lectureId: string) {
  const user = await requireUser();
  if (!hasAiConsent(user)) return;
  const lecture = await requireOwnedLecture(lectureId, user.id);
  if (lecture.status !== "FAILED") return;

  if (lecture.transcriptText) {
    // Already have a transcript — the failure was in note generation, retry just that.
    await prisma.lecture.update({
      where: { id: lecture.id },
      data: { status: "GENERATING_NOTES", errorMessage: null, updatedAt: new Date() },
    });
    after(() => generateNotes(lecture.id, lecture.transcriptText ?? "", lecture.classId));
  } else if (!lecture.audioUrl) {
    // No transcript and no audio — shouldn't happen (a pasted-transcript
    // lecture always has transcriptText, an audio one always has audioUrl),
    // but fail loudly instead of calling AssemblyAI with a null URL.
    await prisma.lecture.update({
      where: { id: lecture.id },
      data: { errorMessage: "This lecture has neither a transcript nor an audio file to retry from." },
    });
  } else {
    await submitTranscription(lecture.id, lecture.audioUrl);
  }
  revalidatePath(`/classes/${lecture.classId}`);
}

export async function deleteLectureAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);

  if (lecture.audioUrl) {
    try {
      await del(lecture.audioUrl);
    } catch (err) {
      // Best-effort — don't block deleting the record if Blob cleanup fails.
      console.error("Lecture audio blob delete failed:", err);
    }
  }
  // Normally already gone (deleted once the transcript was saved), but
  // lectures transcribed before that cleanup existed still have one.
  await deleteAssemblyAITranscripts([lecture.assemblyaiId]);

  // Its note in the Notes tab, if any, stays (Note.lectureId is SetNull).
  await prisma.lecture.delete({ where: { id: lecture.id } });
  revalidatePath(`/classes/${lecture.classId}`);
}

/** Puts a lecture's notes back in the Notes tab after the student deleted that copy. */
export async function addLectureNotesToNotesAction(lectureId: string): Promise<{ noteId: string | null }> {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);
  const noteId = await addLectureToNotes(lecture.id);
  revalidatePath(`/classes/${lecture.classId}`);
  return { noteId };
}

const createLectureFromTranscriptSchema = z.object({
  title: z.string().min(1).max(160),
  transcriptText: z.string().min(1).max(200_000),
});

/**
 * Alternate path into the same pipeline as createLectureAction, for a
 * transcript the user already has (from elsewhere, or typed up themselves)
 * instead of an audio file — skips Blob upload and AssemblyAI entirely and
 * goes straight to note generation. audioUrl stays null on this row. The
 * notes are written after the response, so the student isn't left waiting
 * on the button; the Lectures tab shows the lecture as in progress.
 */
export async function createLectureFromTranscriptAction(
  classId: string,
  input: { title: string; transcriptText: string }
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!hasAiConsent(user)) return { error: AI_CONSENT_MESSAGE };
  await requireOwnedClass(classId, user.id);
  const parsed = createLectureFromTranscriptSchema.parse(input);
  if (!(await consumeRateLimit(`lecture:${user.id}`, RATE_LIMITS.lecture))) {
    return { error: LECTURE_LIMIT_MESSAGE };
  }

  const lecture = await prisma.lecture.create({
    data: {
      classId,
      title: parsed.title,
      transcriptText: parsed.transcriptText,
      status: "GENERATING_NOTES",
    },
  });

  after(() => generateNotes(lecture.id, parsed.transcriptText, classId));
  revalidatePath(`/classes/${classId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Class materials — textbook/slide content that informs every lecture's
// notes in the class (see the ClassMaterial model and generateNotes above).
// ---------------------------------------------------------------------------

const classMaterialSchema = z.object({
  type: z.enum(["BOOK", "SLIDES"]),
  title: z.string().min(1).max(MAX_MATERIAL_TITLE_LENGTH),
  content: z.string().min(1).max(MAX_MATERIAL_CONTENT_LENGTH),
});

export async function addClassMaterialAction(classId: string, formData: FormData) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = classMaterialSchema.safeParse({
    type: formData.get("type"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) throw new Error("Enter a title and some content.");

  await prisma.classMaterial.create({
    data: { classId, type: parsed.data.type, title: parsed.data.title, content: parsed.data.content },
  });
  revalidatePath(`/classes/${classId}`);
}

// Basic SSRF guard for a server-side fetch of a user-supplied URL — not
// exhaustive (doesn't cover DNS rebinding or a redirect chain that lands on
// an internal address), but a reasonable floor for a personal single-user
// app rather than no check at all.
function isFetchableUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "169.254.169.254") return false;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024; // plenty for an HTML page; guards against something absurd

/**
 * Fetches a URL once and extracts readable text — used only at add-time
 * (see addClassMaterialFromUrlAction). The result is stored as-is; the link
 * itself is never fetched again, so a page changing or disappearing later
 * doesn't affect what was already saved.
 */
async function fetchReadableTextFromUrl(rawUrl: string): Promise<{ title: string | null; content: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!isFetchableUrl(url)) {
    throw new Error("That URL can't be fetched.");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CampusOS/1.0)" },
      redirect: "follow",
    });
  } catch (err) {
    console.error("Class material URL fetch failed:", err);
    throw new Error("Couldn't reach that link. Check the URL and try again.");
  }

  if (!res.ok) {
    throw new Error(`That link returned an error (${res.status}). Check the URL and try again.`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(
      `That link doesn't look like a webpage we can read (got "${contentType.split(";")[0] || "unknown"}"). Try pasting the text directly instead.`
    );
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > MAX_FETCH_BYTES) {
    throw new Error("That page is too large to read.");
  }

  const html = await res.text();
  const title = extractHtmlTitle(html);
  const content = htmlToReadableText(html).slice(0, MAX_MATERIAL_CONTENT_LENGTH);

  if (content.length < 100) {
    throw new Error(
      "Couldn't find readable text on that page — it might require JavaScript to load. Try pasting the text directly instead."
    );
  }

  return { title, content };
}

const classMaterialUrlSchema = z.object({
  type: z.enum(["BOOK", "SLIDES"]),
  title: z.string().max(MAX_MATERIAL_TITLE_LENGTH).optional(),
  url: z.string().url(),
});

export async function addClassMaterialFromUrlAction(
  classId: string,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = classMaterialUrlSchema.safeParse({
    type: formData.get("type"),
    title: (formData.get("title") as string) || undefined,
    url: formData.get("url"),
  });
  if (!parsed.success) return { error: "Enter a valid link." };

  // Classified against the current user's OWN connected Canvas account
  // (null if they haven't connected one), not a global env var — this used
  // to read CANVAS_BASE_URL/CANVAS_ACCESS_TOKEN directly, so every user's
  // pasted Canvas links were fetched using whichever account happened to
  // be in that env var, regardless of who was actually signed in. With no
  // account connected, every URL classifies as "external" and falls
  // through to the plain-webpage fetch below, same as before Canvas
  // support existed.
  const account = await prisma.canvasAccount.findUnique({ where: { userId: user.id } });
  const canvasCfg: CanvasConfig | null = account
    ? { baseUrl: account.baseUrl, token: decryptSecret(account.accessTokenEnc) }
    : null;
  const canvasUrl = classifyCanvasUrl(new URL(parsed.data.url), canvasCfg?.baseUrl);
  if (canvasUrl.kind === "canvas-page") {
    return {
      error:
        'That\'s a Canvas page, not a link to one specific file. Open the file itself in Canvas and copy that link (it should contain "/files/12345"), or paste the text directly.',
    };
  }

  // Thrown errors lose their message in production (Next.js redacts Server
  // Action error text, keeping only a log digest), which would turn every
  // one of fetchReadableTextFromUrl's/fetchCanvasFileContent's specific,
  // actionable messages into a generic "something went wrong" — so catch
  // here and return the message as data instead of letting it cross the
  // server/client boundary as a throw.
  try {
    const { title: pageTitle, content } =
      canvasUrl.kind === "file" && canvasCfg
        ? await fetchCanvasFileContent(canvasCfg, canvasUrl.fileId)
        : await fetchReadableTextFromUrl(parsed.data.url);
    const title = (parsed.data.title?.trim() || pageTitle || "Untitled").slice(0, MAX_MATERIAL_TITLE_LENGTH);

    await prisma.classMaterial.create({
      data: {
        classId,
        type: parsed.data.type,
        title,
        content: content.slice(0, MAX_MATERIAL_CONTENT_LENGTH),
        sourceUrl: parsed.data.url,
      },
    });
    revalidatePath(`/classes/${classId}`);
    return undefined;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't fetch that link. Please try again." };
  }
}

const classMaterialFileSchema = z.object({
  type: z.enum(["BOOK", "SLIDES"]),
  title: z.string().max(MAX_MATERIAL_TITLE_LENGTH).optional(),
});

/**
 * Adds a material from a file uploaded directly from the user's device —
 * for slides/books that aren't on Canvas at all (emailed, downloaded
 * elsewhere, etc.). Reuses the same extractDocumentText() the Canvas-file
 * path uses, so the same PDF/PPTX/DOCX formats are supported either way.
 * No sourceUrl — there's no external location this came from to reference.
 */
export async function addClassMaterialFromFileAction(
  classId: string,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file first." };
  }

  const parsed = classMaterialFileSchema.safeParse({
    type: formData.get("type"),
    title: (formData.get("title") as string) || undefined,
  });
  if (!parsed.success) return { error: "Enter a valid type." };

  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return { error: "That file is too large to read." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    return await saveMaterialFromDocument(classId, buffer, file.type, file.name, parsed.data);
  } catch (err) {
    console.error("Class material file extraction failed:", err);
    return { error: "Couldn't read that file. Please try again." };
  }
}

/** Shared by the direct and the Blob upload paths: pull the text out and save it as a material. */
async function saveMaterialFromDocument(
  classId: string,
  buffer: Buffer,
  contentType: string,
  fileName: string,
  options: { type: "BOOK" | "SLIDES"; title?: string }
): Promise<{ error: string } | undefined> {
  const content = await extractDocumentText(buffer, contentType, fileName);

  if (content === null) {
    const ext = fileName.split(".").pop()?.toUpperCase();
    return { error: `Can't read ${ext ? `${ext} files` : "that file"} yet — try pasting the text directly instead.` };
  }
  if (content.trim().length < 20) {
    return {
      error: "Couldn't find readable text in that file — it might be scanned images. Try pasting the text directly instead.",
    };
  }

  const title = (options.title?.trim() || fileName.replace(/\.[^.]+$/, "") || "Untitled").slice(0, MAX_MATERIAL_TITLE_LENGTH);

  await prisma.classMaterial.create({
    data: {
      classId,
      type: options.type,
      title,
      content: content.slice(0, MAX_MATERIAL_CONTENT_LENGTH),
      sourceUrl: null,
    },
  });
  revalidatePath(`/classes/${classId}`);
  return undefined;
}

const classMaterialBlobSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(300),
  type: z.enum(["BOOK", "SLIDES"]),
  title: z.string().max(MAX_MATERIAL_TITLE_LENGTH).optional(),
});

/**
 * Second half of a large book/slide upload: the browser has already put
 * the file in Blob storage via /api/material-upload (Server Actions can't
 * take more than 4.5 MB on Vercel). Reads the text out, saves the
 * material, and always deletes the uploaded file; only the text is kept,
 * same as the direct upload path.
 */
export async function addClassMaterialFromBlobAction(
  classId: string,
  input: { url: string; fileName: string; type: string; title?: string }
): Promise<{ error: string } | undefined> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = classMaterialBlobSchema.safeParse(input);
  if (!parsed.success) return { error: "Something about that upload looked wrong. Please try again." };

  const url = new URL(parsed.data.url);
  // Only a file this class just uploaded to this app's own Blob storage;
  // never an arbitrary URL, which would make this a server-side fetch of
  // whatever the client asks for.
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    !url.pathname.startsWith(`/materials/${classId}/`)
  ) {
    return { error: "That upload couldn't be found. Please try again." };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: "Couldn't read the uploaded file. Please try again." };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOCUMENT_FILE_BYTES) return { error: "That file is too large to read." };
    return await saveMaterialFromDocument(classId, buffer, res.headers.get("content-type") ?? "", parsed.data.fileName, {
      type: parsed.data.type,
      title: parsed.data.title,
    });
  } catch (err) {
    console.error("Class material extraction from Blob failed:", err);
    return { error: "Couldn't read that file. Please try again." };
  } finally {
    await del(url.toString()).catch((err) => console.error("Deleting uploaded material file failed:", err));
  }
}

export async function deleteClassMaterialAction(materialId: string) {
  const user = await requireUser();
  const material = await requireOwnedMaterial(materialId, user.id);
  await prisma.classMaterial.delete({ where: { id: material.id } });
  revalidatePath(`/classes/${material.classId}`);
}

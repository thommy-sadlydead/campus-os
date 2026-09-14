"use server";

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAssemblyAIClient } from "@/lib/assemblyai";
import { getAnthropicClient, MODEL } from "@/lib/anthropic";
import { buildLectureNotesPrompt, MAX_MATERIAL_TITLE_LENGTH, MAX_MATERIAL_CONTENT_LENGTH } from "@/lib/lecture-notes";
import { htmlToReadableText, extractHtmlTitle } from "@/lib/text";
import { classifyCanvasUrl } from "@/lib/canvas";
import { extractDocumentText } from "@/lib/office-text";

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

const NOT_CONFIGURED = {
  assemblyai: "Transcription isn't configured yet. Add an ASSEMBLYAI_API_KEY to enable it.",
  anthropic: "Note generation isn't configured yet. Add an ANTHROPIC_API_KEY to enable it.",
};

/**
 * Runs the note-generation step and saves the result. Like Voicewrite's
 * /api/voicewrite-generate, this calls the Anthropic SDK directly rather than
 * through askClaude() — askClaude() collapses every failure into a silent
 * null for features that have a deterministic fallback, but note generation
 * IS the feature here, so failures need to surface as a real FAILED status
 * with a real message instead.
 *
 * Pulls in the class's materials (books/slides — see ClassMaterial) as
 * extra context every time, so they inform every lecture in the class
 * without needing to be re-attached per lecture.
 */
async function generateNotes(lectureId: string, transcriptText: string, classId: string) {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.anthropic },
    });
    return;
  }

  const materials = await prisma.classMaterial.findMany({
    where: { classId },
    orderBy: { createdAt: "asc" },
  });
  const { system, prompt } = buildLectureNotesPrompt(transcriptText, materials);
  try {
    const message = await anthropic.messages.create(
      { model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: prompt }] },
      { timeout: 60_000 }
    );
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "FAILED", errorMessage: "Note generation returned an empty response. Please try again." },
      });
      return;
    }
    await prisma.lecture.update({ where: { id: lectureId }, data: { status: "READY", notesMarkdown: text } });
  } catch (err) {
    console.error("Lecture note generation failed:", err);
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: "Note generation failed. Please try again." },
    });
  }
}

const createLectureSchema = z.object({
  title: z.string().min(1).max(160),
  audioUrl: z.string().url(),
});

/**
 * Called by the client right after its direct-to-Blob upload resolves (see
 * src/app/api/lecture-audio/upload/route.ts) — NOT from Vercel Blob's
 * onUploadCompleted webhook, which needs a publicly reachable callback URL
 * that `next dev` doesn't have. Creates the row, then submits the
 * transcription job immediately so the panel can start polling right away.
 */
export async function createLectureAction(classId: string, input: { title: string; audioUrl: string }) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);
  const parsed = createLectureSchema.parse(input);

  const lecture = await prisma.lecture.create({
    data: { classId, title: parsed.title, audioUrl: parsed.audioUrl, status: "UPLOADED" },
  });

  const assemblyai = getAssemblyAIClient();
  if (!assemblyai) {
    await prisma.lecture.update({
      where: { id: lecture.id },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
    });
  } else {
    try {
      const transcript = await assemblyai.transcripts.submit({ audio_url: parsed.audioUrl });
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "TRANSCRIBING", assemblyaiId: transcript.id },
      });
    } catch (err) {
      console.error("Lecture transcription submit failed:", err);
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: "Couldn't submit the audio for transcription. Please try again." },
      });
    }
  }

  revalidatePath(`/classes/${classId}`);
}

/**
 * Advances one lecture by one step: checks AssemblyAI if a transcript is in
 * flight, and kicks off note generation the moment it completes. The client
 * calls this on an interval for every non-terminal lecture (see
 * LecturesPanel) — there's no background worker, so polling IS how state
 * advances, same as the "async submit/poll" architecture AssemblyAI expects.
 */
export async function pollLectureStatusAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);

  if (lecture.status === "TRANSCRIBING" && lecture.assemblyaiId) {
    const assemblyai = getAssemblyAIClient();
    if (!assemblyai) {
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
      });
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }

    let transcript;
    try {
      transcript = await assemblyai.transcripts.get(lecture.assemblyaiId);
    } catch (err) {
      // Transient (network blip, rate limit) — leave status alone and let
      // the next poll tick try again instead of failing the lecture outright.
      console.error("Lecture transcript poll failed:", err);
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }

    if (transcript.status === "error") {
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: transcript.error || "Transcription failed." },
      });
    } else if (transcript.status === "completed") {
      const transcriptText = transcript.text || "";
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "GENERATING_NOTES", transcriptText },
      });
      await generateNotes(lecture.id, transcriptText, lecture.classId);
    }
    // "queued" / "processing": no-op, poll again later.
  } else if (lecture.status === "GENERATING_NOTES") {
    // A previous poll started note generation but the row never advanced
    // (e.g. the serverless function was killed mid-request) — retry from
    // the transcript already saved on the row.
    await generateNotes(lecture.id, lecture.transcriptText || "", lecture.classId);
  }

  revalidatePath(`/classes/${lecture.classId}`);
}

export async function retryLectureAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);
  if (lecture.status !== "FAILED") return;

  if (lecture.transcriptText) {
    // Already have a transcript — the failure was in note generation, retry just that.
    await prisma.lecture.update({ where: { id: lecture.id }, data: { status: "GENERATING_NOTES", errorMessage: null } });
    await generateNotes(lecture.id, lecture.transcriptText, lecture.classId);
  } else if (!lecture.audioUrl) {
    // No transcript and no audio — shouldn't happen (a pasted-transcript
    // lecture always has transcriptText, an audio one always has audioUrl),
    // but fail loudly instead of calling AssemblyAI with a null URL.
    await prisma.lecture.update({
      where: { id: lecture.id },
      data: { errorMessage: "This lecture has neither a transcript nor an audio file to retry from." },
    });
    revalidatePath(`/classes/${lecture.classId}`);
  } else {
    const assemblyai = getAssemblyAIClient();
    if (!assemblyai) {
      await prisma.lecture.update({ where: { id: lecture.id }, data: { errorMessage: NOT_CONFIGURED.assemblyai } });
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }
    try {
      const transcript = await assemblyai.transcripts.submit({ audio_url: lecture.audioUrl });
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "TRANSCRIBING", assemblyaiId: transcript.id, errorMessage: null },
      });
    } catch (err) {
      console.error("Lecture retry submit failed:", err);
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { errorMessage: "Couldn't submit the audio for transcription. Please try again." },
      });
    }
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

  await prisma.lecture.delete({ where: { id: lecture.id } });
  revalidatePath(`/classes/${lecture.classId}`);
}

const createLectureFromTranscriptSchema = z.object({
  title: z.string().min(1).max(160),
  transcriptText: z.string().min(1).max(200_000),
});

/**
 * Alternate path into the same pipeline as createLectureAction, for a
 * transcript the user already has (from elsewhere, or typed up themselves)
 * instead of an audio file — skips Blob upload and AssemblyAI entirely and
 * goes straight to note generation. audioUrl stays null on this row.
 */
export async function createLectureFromTranscriptAction(
  classId: string,
  input: { title: string; transcriptText: string }
) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);
  const parsed = createLectureFromTranscriptSchema.parse(input);

  const lecture = await prisma.lecture.create({
    data: {
      classId,
      title: parsed.title,
      transcriptText: parsed.transcriptText,
      status: "GENERATING_NOTES",
    },
  });

  await generateNotes(lecture.id, parsed.transcriptText, classId);
  revalidatePath(`/classes/${classId}`);
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

// Document files (Canvas downloads, or a direct upload) can be genuinely
// large (slide decks with embedded images), so this is more generous than
// MAX_FETCH_BYTES for plain HTML pages — but still bounded, since only the
// extracted *text* matters and that's capped separately at
// MAX_MATERIAL_CONTENT_LENGTH regardless. Shared by the Canvas-file path
// and the direct-upload path below.
const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

interface CanvasFileMeta {
  display_name: string;
  "content-type"?: string;
  size: number;
  url: string;
  locked_for_user?: boolean;
}

/**
 * Fetches one Canvas-hosted file's content via the Canvas REST API (using
 * this app's existing CANVAS_ACCESS_TOKEN — the same one scripts/sync-canvas
 * uses for courses/assignments) and extracts readable text from it. Unlike
 * fetchReadableTextFromUrl, this never touches the file's *page* URL
 * directly — that requires a logged-in Canvas session this server doesn't
 * have — only the API, which authenticates with the token instead.
 */
async function fetchCanvasFileText(fileId: string): Promise<{ title: string | null; content: string }> {
  const baseUrl = process.env.CANVAS_BASE_URL;
  const token = process.env.CANVAS_ACCESS_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("Canvas isn't connected for this app, so file links can't be fetched yet.");
  }

  let meta: CanvasFileMeta;
  try {
    const metaRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (metaRes.status === 404) {
      throw new Error("Couldn't find that file in Canvas. Check the link and try again.");
    }
    if (!metaRes.ok) {
      throw new Error(`Canvas returned an error (${metaRes.status}) looking up that file.`);
    }
    meta = await metaRes.json();
  } catch (err) {
    if (err instanceof Error && /^(Couldn't find|Canvas returned)/.test(err.message)) throw err;
    throw new Error("Couldn't reach Canvas to look up that file.");
  }

  if (meta.locked_for_user) {
    throw new Error("That file is locked in Canvas, so it can't be read yet.");
  }
  if (meta.size > MAX_DOCUMENT_FILE_BYTES) {
    throw new Error("That file is too large to read.");
  }

  // meta.url is a short-lived, pre-signed download link Canvas issues
  // per-request — it's directly fetchable and does NOT take the API
  // bearer token (it's typically backed by S3-style query-signed auth,
  // which an extra Authorization header can actually break).
  let fileRes: Response;
  try {
    fileRes = await fetch(meta.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error("Couldn't download that file from Canvas.");
  }
  if (!fileRes.ok) {
    throw new Error("Couldn't download that file from Canvas.");
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const contentType = meta["content-type"] || fileRes.headers.get("content-type") || "";

  let content: string | null;
  try {
    content = await extractDocumentText(buffer, contentType, meta.display_name);
  } catch (err) {
    console.error("Canvas file text extraction failed:", err);
    throw new Error("Couldn't read that file — it might be corrupted or password-protected.");
  }

  if (content === null) {
    throw new Error(
      `Can't read ${meta.display_name.split(".").pop()?.toUpperCase() || "that"} files yet — try pasting the text directly instead.`
    );
  }
  if (content.trim().length < 20) {
    throw new Error(
      "Couldn't find readable text in that file — it might be scanned images. Try pasting the text directly instead."
    );
  }

  return { title: meta.display_name, content };
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

  const canvasUrl = classifyCanvasUrl(new URL(parsed.data.url), process.env.CANVAS_BASE_URL);
  if (canvasUrl.kind === "canvas-page") {
    return {
      error:
        'That\'s a Canvas page, not a link to one specific file. Open the file itself in Canvas and copy that link (it should contain "/files/12345"), or paste the text directly.',
    };
  }

  // Thrown errors lose their message in production (Next.js redacts Server
  // Action error text, keeping only a log digest), which would turn every
  // one of fetchReadableTextFromUrl's/fetchCanvasFileText's specific,
  // actionable messages into a generic "something went wrong" — so catch
  // here and return the message as data instead of letting it cross the
  // server/client boundary as a throw.
  try {
    const { title: pageTitle, content } =
      canvasUrl.kind === "file"
        ? await fetchCanvasFileText(canvasUrl.fileId)
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
    const content = await extractDocumentText(buffer, file.type, file.name);

    if (content === null) {
      const ext = file.name.split(".").pop()?.toUpperCase();
      return { error: `Can't read ${ext ? `${ext} files` : "that file"} yet — try pasting the text directly instead.` };
    }
    if (content.trim().length < 20) {
      return {
        error: "Couldn't find readable text in that file — it might be scanned images. Try pasting the text directly instead.",
      };
    }

    const title = (parsed.data.title?.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled").slice(
      0,
      MAX_MATERIAL_TITLE_LENGTH
    );

    await prisma.classMaterial.create({
      data: {
        classId,
        type: parsed.data.type,
        title,
        content: content.slice(0, MAX_MATERIAL_CONTENT_LENGTH),
        sourceUrl: null,
      },
    });
    revalidatePath(`/classes/${classId}`);
    return undefined;
  } catch (err) {
    console.error("Class material file extraction failed:", err);
    return { error: "Couldn't read that file. Please try again." };
  }
}

export async function deleteClassMaterialAction(materialId: string) {
  const user = await requireUser();
  const material = await requireOwnedMaterial(materialId, user.id);
  await prisma.classMaterial.delete({ where: { id: material.id } });
  revalidatePath(`/classes/${material.classId}`);
}

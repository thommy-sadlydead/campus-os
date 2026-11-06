import { authenticateExtension, redeemPairingCode } from "@/lib/lms/extension-auth";
import { finishSync, importCourses, importSummary, ingestUpload, planMaterials, recordFailure } from "@/lib/lms/extension-import";
import {
  MAX_PART_BYTES,
  coursesPayload,
  failurePayload,
  finishPayload,
  materialsPayload,
  parseUploadHeader,
} from "@/lib/lms/extension-protocol";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { RATE_LIMITS, clientIp, consumeRateLimit } from "@/lib/rate-limit";

// The Campus OS Chrome extension's endpoints (chrome-extension/src/api.js).
// Every one but "pair" needs the extension's token (src/lib/lms/
// extension-auth.ts). No CORS headers: the extension has host permission
// for this site, and web pages have no business calling these.
//
//   POST pair       { code } → { token, email }
//   GET  session    → { email, connections, courses }
//   POST courses    courses, assignments, exams → classes
//   POST materials  a course's file list → which ones to send
//   POST upload     one part of a file or page (X-Campus-Upload header)
//   POST failed     a file the extension couldn't download
//   POST finish     the end of a sync → what's now in Campus OS
//   POST disconnect revokes this token

// Reading a big PDF (or OCR'ing a scanned one) can take a while.
export const maxDuration = 300;

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) throw new Error("too large");
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) throw new Error("too large");
  return JSON.parse(raw);
}

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "session") return json(404, { error: "Not found." });
  const auth = await authenticateExtension(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const connections = await prisma.lmsConnection.findMany({
    where: { userId: auth.user.id, provider: { in: ["brightspace", "blackboard"] } },
    select: { provider: true, baseUrl: true, method: true, lastSyncedAt: true },
  });
  return json(200, {
    email: auth.user.email,
    connections: await Promise.all(
      connections.map(async (c) => ({
        provider: c.provider,
        origin: c.method === "extension" ? c.baseUrl : null,
        method: c.method ?? "calendar",
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        courses: c.method === "extension" ? await importSummary(auth.user.id, c.provider as "brightspace" | "blackboard") : [],
      }))
    ),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;

  if (action === "pair") {
    if (!(await consumeRateLimit(`extension-pair-ip:${await clientIp()}`, RATE_LIMITS.extensionPairIp))) {
      return json(429, { error: "Too many tries. Wait a few minutes and connect again." });
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      return json(400, { error: "Bad request." });
    }
    const code = typeof (body as { code?: unknown })?.code === "string" ? (body as { code: string }).code : "";
    const paired = await redeemPairingCode(code);
    if (!paired) return json(400, { error: "That connection code has expired. Click Connect on the Campus OS page again." });
    return json(200, paired);
  }

  const auth = await authenticateExtension(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const user = auth.user;

  if (action === "disconnect") {
    const token = /^Bearer\s+(\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    await prisma.extensionToken.deleteMany({ where: { userId: user.id, tokenHash: hashToken(token) } });
    return json(200, { ok: true });
  }

  if (action === "upload") {
    const header = parseUploadHeader(request.headers.get("x-campus-upload"));
    if (!header) return json(400, { error: "Bad upload." });
    if (!(await consumeRateLimit(`extension-upload:${user.id}`, RATE_LIMITS.extensionUpload))) {
      return json(429, { error: "That's a lot of files for one day. The rest will come in on a later sync." });
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_PART_BYTES) return json(413, { error: "Part too large." });
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > MAX_PART_BYTES) return json(413, { error: "Part too large." });
    const result = await ingestUpload(user, header, body);
    return "error" in result ? json(result.code, { error: result.error }) : json(200, result);
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return json(400, { error: "Bad request." });
  }

  if (action === "courses") {
    const parsed = coursesPayload.safeParse(body);
    if (!parsed.success) return json(400, { error: "The course list didn't come through right.", issues: parsed.error.issues.slice(0, 5) });
    return json(200, await importCourses(user, parsed.data));
  }
  if (action === "materials") {
    const parsed = materialsPayload.safeParse(body);
    if (!parsed.success) return json(400, { error: "The file list didn't come through right.", issues: parsed.error.issues.slice(0, 5) });
    const result = await planMaterials(user, parsed.data);
    return "error" in result ? json(404, result) : json(200, result);
  }
  if (action === "failed") {
    const parsed = failurePayload.safeParse(body);
    if (!parsed.success) return json(400, { error: "Bad request." });
    const result = await recordFailure(user, parsed.data);
    return "error" in result ? json(result.code, { error: result.error }) : json(200, result);
  }
  if (action === "finish") {
    const parsed = finishPayload.safeParse(body);
    if (!parsed.success) return json(400, { error: "Bad request." });
    const result = await finishSync(user, parsed.data);
    return "error" in result ? json(409, result) : json(200, result);
  }
  return json(404, { error: "Not found." });
}

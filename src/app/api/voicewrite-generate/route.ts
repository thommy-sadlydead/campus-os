import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/auth";
import { getAnthropicClient, MODEL } from "@/lib/anthropic";
import {
  MAX_AUDIENCE_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SAMPLE_LENGTH,
} from "@/lib/voicewrite/constants";
import { buildSystemPrompt, LENGTH_MAX_TOKENS } from "@/lib/voicewrite/prompt";
import type {
  ApiErrorBody,
  GenerateRequestBody,
  GenerateResponseBody,
  LengthOption,
  ToneOption,
} from "@/lib/voicewrite/types";

export const dynamic = "force-dynamic";

const TONE_VALUES: ToneOption[] = [
  "natural",
  "casual",
  "professional",
  "academic",
  "friendly",
  "persuasive",
];
const LENGTH_VALUES: LengthOption[] = ["short", "medium", "long"];

const REQUEST_TIMEOUT_MS = 45_000;

function errorResponse(message: string, status: number) {
  return NextResponse.json<ApiErrorBody>({ error: message }, { status });
}

// Ported from Voicewrite's standalone src/app/api/generate/route.ts per
// INTEGRATION.md, renamed so it doesn't collide with any future host route
// at /api/generate. Reuses Campus OS's own Anthropic client/model resolution
// (src/lib/anthropic.ts) instead of the standalone app's raw fetch + hardcoded
// model string, and is gated on a signed-in Campus OS user — this route is
// called via fetch() from client JS, not a full page navigation, so it
// returns a plain 401 JSON body (via getCurrentUser) rather than
// requireUser()'s redirect, which a fetch() caller can't follow usefully.
//
// This intentionally does NOT go through askClaude()/askClaudeForJson() in
// src/lib/anthropic.ts: those collapse every failure (missing key, bad key,
// rate limit, timeout) into a single null, which is fine for this app's
// other AI features because they all have a deterministic non-AI fallback.
// Voicewrite's generation has no such fallback — text generation IS the
// feature — so this route keeps the standalone app's original granular,
// status-code-aware error messages instead.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse("You need to be signed in to generate text.", 401);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return errorResponse(
      "The writing service isn't configured yet. Add an ANTHROPIC_API_KEY to enable it.",
      500
    );
  }

  let body: Partial<GenerateRequestBody>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body wasn't valid JSON.", 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return errorResponse("Tell us what you'd like to write before generating.", 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse(
      `Your request is too long. Please keep it under ${MAX_PROMPT_LENGTH} characters.`,
      400
    );
  }

  const tone = body.tone;
  if (!tone || !TONE_VALUES.includes(tone)) {
    return errorResponse("Choose a valid tone.", 400);
  }

  const length = body.length;
  if (!length || !LENGTH_VALUES.includes(length)) {
    return errorResponse("Choose a valid length.", 400);
  }

  const audience =
    typeof body.audience === "string" && body.audience.trim()
      ? body.audience.trim().slice(0, MAX_AUDIENCE_LENGTH)
      : "General audience";

  const styleSample =
    typeof body.styleSample === "string"
      ? body.styleSample.trim().slice(0, MAX_SAMPLE_LENGTH)
      : undefined;

  const system = buildSystemPrompt({ tone, length, audience, styleSample });

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: LENGTH_MAX_TOKENS[length],
        system,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      return errorResponse(
        "The writing service returned an empty response. Please try again.",
        502
      );
    }

    return NextResponse.json<GenerateResponseBody>({ text });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return errorResponse("The request took too long. Please try again.", 504);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Voicewrite generate: Anthropic API error", err.status, err.message);
      if (err.status === 401) {
        return errorResponse(
          "The writing service isn't configured correctly. The site owner needs to check the API key.",
          500
        );
      }
      if (err.status === 429) {
        return errorResponse(
          "You're sending requests too quickly. Please wait a moment and try again.",
          429
        );
      }
      if (err.status && err.status >= 500) {
        return errorResponse(
          "The writing service is temporarily unavailable. Please try again in a moment.",
          502
        );
      }
      return errorResponse(
        "Something went wrong generating your text. Please try again.",
        400
      );
    }
    console.error("Voicewrite generate route failed", err);
    return errorResponse(
      "Couldn't reach the writing service. Check your connection and try again.",
      502
    );
  }
}

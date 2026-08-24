import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null | undefined;

/** Null when ANTHROPIC_API_KEY isn't configured — callers must have a non-AI fallback. */
export function getAnthropicClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey }) : null;
  return client;
}

// Override with ANTHROPIC_MODEL if you want a different tier/version — see
// https://docs.claude.com/en/docs/about-claude/models for current model IDs.
// Exported so other AI-backed routes (e.g. Voicewrite's /api/voicewrite-generate,
// which calls the SDK directly instead of through askClaude) stay on the same
// model Reece has configured, instead of hardcoding a second default.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/**
 * One-shot text completion with a system prompt. Returns null on any
 * failure (missing key, API error) rather than throwing — every caller in
 * this app is expected to have a deterministic fallback, per the "don't
 * fabricate, don't break if AI is unavailable" requirement.
 */
export async function askClaude(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 500,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("askClaude failed:", err);
    return null;
  }
}

/**
 * Same as askClaude but requires the model to return one JSON object
 * matching the caller's expected shape (assignment breakdown, email
 * extraction, etc). Returns null on any failure or parse error — callers
 * must fall back to heuristics, never surface a broken AI response as if
 * it were real data.
 */
export async function askClaudeForJson<T>(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<T | null> {
  const text = await askClaude({
    ...opts,
    system: `${opts.system}\n\nRespond with ONLY a single valid JSON value — no prose, no markdown code fences.`,
  });
  if (!text) return null;
  try {
    // Models occasionally wrap JSON in a fenced block despite instructions; strip it defensively.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("askClaudeForJson: failed to parse model output as JSON:", err);
    return null;
  }
}

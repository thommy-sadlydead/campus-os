import "server-only";
import { AssemblyAI } from "assemblyai";

let client: AssemblyAI | null | undefined;

/**
 * Null when ASSEMBLYAI_API_KEY isn't configured. Unlike src/lib/anthropic.ts's
 * askClaude(), there's no deterministic fallback for transcription — callers
 * (src/app/classes/[id]/lecture-actions.ts) must surface this as a real
 * error, same as Voicewrite's Anthropic client (src/app/api/voicewrite-generate).
 */
export function getAssemblyAIClient(): AssemblyAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  client = apiKey ? new AssemblyAI({ apiKey }) : null;
  return client;
}

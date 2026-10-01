import "server-only";
import { AssemblyAI } from "assemblyai";

let client: AssemblyAI | null | undefined;

/**
 * Null when ASSEMBLYAI_API_KEY isn't configured. Unlike src/lib/anthropic.ts's
 * askClaude(), there's no deterministic fallback for transcription — callers
 * (src/app/classes/[id]/lecture-actions.ts) must surface this as a real
 * error.
 */
export function getAssemblyAIClient(): AssemblyAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  client = apiKey ? new AssemblyAI({ apiKey }) : null;
  return client;
}

/**
 * Asks AssemblyAI to delete finished transcripts, best effort. Once a
 * lecture's transcript text is saved on its row, nothing here reads
 * AssemblyAI's copy again, and AssemblyAI would otherwise keep it for about
 * 30 days. AssemblyAI only deletes completed transcripts, so a failure is
 * logged and ignored rather than blocking whatever called this.
 */
export async function deleteAssemblyAITranscripts(ids: Array<string | null | undefined>): Promise<void> {
  const assemblyai = getAssemblyAIClient();
  if (!assemblyai) return;
  await Promise.all(
    ids
      .filter((id): id is string => Boolean(id))
      .map((id) =>
        assemblyai.transcripts.delete(id).catch((err) => console.error(`AssemblyAI transcript ${id} delete failed:`, err))
      )
  );
}

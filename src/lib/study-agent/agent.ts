import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/anthropic";
import { TUTOR_MODE_INSTRUCTIONS } from "@/lib/class-context";
import { formatInTimeZone } from "date-fns-tz";
import { StudyToolError, runStudyTool, studyTools, type StudyScope } from "@/lib/study-agent/tools";

// The study assistant behind "Ask about everything" (Today) and each class's
// assistant. Instead of answering from a fixed bundle of context, it looks
// things up first with the tools in ./tools.ts: for "help me study for my
// quiz tomorrow" it finds the quiz, reads its directions to see what it
// covers, searches and reads the matching lecture notes and course files,
// and only then writes the study guide.

export const STUDY_AGENT_MODEL = process.env.STUDY_AGENT_MODEL || "claude-opus-5-5";

// A question usually needs 2-5 rounds of lookups. The caps keep one
// question inside the serverless time limit (the pages set maxDuration to
// 300 s) and its cost bounded; when one is hit, the model answers with what
// it has gathered.
const MAX_TOOL_ROUNDS = 8;
const TIME_BUDGET_MS = 150_000;
const MAX_TOKENS = 16_000;

const SYSTEM = [
  "You are the study assistant inside Campus OS, a planner for college students. You're talking with one student, " +
    "and you can look up their classes, assignments, quizzes, exams, lecture notes, their own notes, and the course files " +
    "and pages from their school's site with the tools you have.",
  "",
  "Look things up before you answer. When a question depends on the student's coursework, gather what you need first:",
  "1. Work out what they mean. \"My quiz tomorrow\", \"the next exam\", \"this week's homework\": find it with find_upcoming_work. " +
    "If more than one thing fits, pick the one that fits best and say which you picked.",
  "2. Find out what it covers. Read its details with get_work_item: directions often name chapters, topics or lectures. " +
    "If they don't, use the syllabus or schedule (list_class_contents, then read it) and the most recent lectures before the due date.",
  "3. Gather the material. Search for each topic with search_class_content, and read the lecture notes, notes and course files " +
    "you'll rely on with read_class_content. Snippets aren't enough to teach from.",
  "4. Then answer, from what you read.",
  "Skip the lookups only when the question doesn't depend on their data (a general concept question) or you already have what you need.",
  "",
  "Stay truthful to what's on file:",
  "- Never invent due dates, grades, quiz coverage, or content. If you can't tell what something covers, say what you based your answer on " +
    "(for example \"the directions don't list topics, so this covers the three lectures since the last quiz\").",
  "- If the material isn't in Campus OS (no lecture notes or files for those topics), say so plainly and suggest what to add, " +
    "then help with what is there. You may explain general concepts from your own knowledge, but say which parts aren't from their materials.",
  "- Say where the material came from, briefly, by title (\"from Lecture 6: Enzymes and your Chapter 3 slides\").",
  "",
  "When you write a study guide, summary or other reference document (not a short direct answer or an iterative quiz), format it for fast " +
    "studying: open each major topic with its core question or a one-line \"big idea\"; use compact markdown tables for comparisons and " +
    "lists of terms instead of long nested bullets; use → for short cause-effect or process chains; bold only the few terms that matter most; " +
    "and close with a condensed high-yield recap for last-minute review. Keep it scannable without dropping real content. " +
    "For short questions, answer briefly and directly. Write in markdown. Don't describe your lookups step by step; just answer.",
].join("\n");

export interface StudyAgentResult {
  answer: string;
  /** Titles of what the assistant read, for a "Based on" line under the answer. */
  sources: string[];
}

interface Deps {
  client?: Pick<Anthropic, "beta"> | null;
  runTool?: typeof runStudyTool;
  now?: () => number;
}

/**
 * Answers one question for one student. Returns null if the AI isn't set
 * up or the request failed, so callers fall back to their real-data answer.
 */
export async function runStudyAgent(
  question: string,
  scope: StudyScope & { className?: string; tutorMode?: boolean },
  deps: Deps = {}
): Promise<StudyAgentResult | null> {
  const client = deps.client === undefined ? getAnthropicClient() : deps.client;
  if (!client) return null;
  const runTool = deps.runTool ?? runStudyTool;
  const clock = deps.now ?? Date.now;
  const started = clock();

  const tools = studyTools(scope);
  // The system prompt and tools stay the same from one request to the
  // next (cacheable); today's date and the class go in the first message.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM },
    ...(scope.tutorMode ? [{ type: "text" as const, text: TUTOR_MODE_INSTRUCTIONS }] : []),
  ];
  system[system.length - 1] = { ...system[system.length - 1], cache_control: { type: "ephemeral" } };

  const context = [
    `Now: ${formatInTimeZone(scope.now, scope.tz, "EEEE, MMMM d, yyyy 'at' h:mm a")} (the student's time zone, ${scope.tz}).`,
    scope.classId
      ? `The student is on the page for their class "${scope.className ?? "this class"}" (id ${scope.classId}). Only this class's data is ` +
        "available to you; don't bring in or compare to their other classes."
      : "The student asked from their Today page, so any of their classes may be relevant.",
  ].join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: `${context}\n\nQuestion: ${question}` }] },
  ];
  const sources = new Set<string>();

  try {
    for (let round = 0; ; round++) {
      const outOfRoom = round >= MAX_TOOL_ROUNDS || clock() - started > TIME_BUDGET_MS;
      const response = await client.beta.messages.create({
        model: STUDY_AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        // Out of rounds or time: answer now from what's been gathered.
        ...(outOfRoom ? { tool_choice: { type: "none" as const } } : {}),
        output_config: { effort: "medium" },
        // If the model declines for policy reasons, Anthropic retries on its
        // default fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages,
      });

      if (response.stop_reason === "refusal") {
        return { answer: "I can't help with that one. Try asking it a different way.", sources: [] };
      }
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0 || outOfRoom) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        if (!text) return null;
        const cutOff = response.stop_reason === "max_tokens" ? "\n\n*(This got cut off. Ask for the rest.)*" : "";
        return { answer: text + cutOff, sources: [...sources] };
      }

      // Thinking and fallback blocks go back exactly as they came.
      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(
        toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          try {
            const content = await runTool(use.name, use.input, scope);
            noteSource(use, content, sources);
            return { type: "tool_result", tool_use_id: use.id, content };
          } catch (err) {
            if (!(err instanceof StudyToolError)) console.error(`Study tool ${use.name} failed:`, err);
            const message = err instanceof StudyToolError ? err.message : "That lookup failed. Try another way.";
            return { type: "tool_result", tool_use_id: use.id, content: message, is_error: true };
          }
        })
      );
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    console.error("Study assistant failed:", err);
    return null;
  }
}

/** What the student will see listed as the answer's sources: the items and files the assistant actually opened. */
function noteSource(use: Anthropic.Beta.BetaToolUseBlock, content: string, sources: Set<string>) {
  if (use.name !== "read_class_content" && use.name !== "get_work_item") return;
  try {
    const parsed = JSON.parse(content) as { title?: string; name?: string };
    const title = parsed.title ?? parsed.name;
    if (title) sources.add(title);
  } catch {
    // A result cut at the size limit isn't valid JSON; its title is at the start.
    const match = /"(?:title|name)":"((?:[^"\\]|\\.)*)"/.exec(content);
    if (match) sources.add(JSON.parse(`"${match[1]}"`));
  }
}

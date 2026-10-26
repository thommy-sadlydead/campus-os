// The Study tab's pure rules (tested in tests/flashcards.test.ts): the AI
// prompt that turns a class's notes into flashcards, reading its answer
// safely, the text Quizlet's import box takes, and the requests the "Study
// with ChatGPT" buttons send.

export const FLASHCARD_COUNTS = [10, 20, 30] as const;
export const DEFAULT_FLASHCARD_COUNT = 20;
/** How much class text one deck is made from (whole items, newest first). */
export const FLASHCARD_SOURCE_BUDGET = 60_000;
const MAX_FRONT = 200;
const MAX_BACK = 600;

export interface FlashcardSource {
  label: string;
  text: string;
}

export interface FlashcardDraft {
  front: string;
  back: string;
}

export function buildFlashcardPrompt(input: {
  className: string;
  sources: FlashcardSource[];
  count: number;
  focus?: string | null;
}): { system: string; prompt: string } {
  const system = [
    "You make study flashcards for a college student from their own class material.",
    `Write exactly ${input.count} flashcards, or fewer if the material doesn't support that many good ones.`,
    "Each card tests one thing: a key term, concept, formula, date, cause and effect, or step the material actually covers. Cover the most important and most testable ideas first, and don't repeat a fact on two cards.",
    "The front is a short term or question (at most 15 words). The back is the answer in one to three plain sentences, at most 60 words.",
    "Only use what's in the material. Never add facts, examples or definitions it doesn't contain.",
    "Write plain text: no markdown, bullet points or LaTeX. Write math the way you'd type it, like x^2 + 3x, sqrt(x) or f'(x).",
    'Respond with JSON shaped exactly like {"cards": [{"front": "...", "back": "..."}]}.',
  ].join(" ");

  const focus = input.focus?.trim();
  const prompt = [
    `Class: ${input.className}`,
    focus ? `Focus the cards on: ${focus}` : null,
    "",
    "Material:",
    "",
    ...input.sources.map((s) => `### ${s.label}\n${s.text}`),
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { system, prompt };
}

const clean = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** The cards from the model's JSON, cleaned up; never more than `max`, duplicates dropped. */
export function parseFlashcards(json: unknown, max: number): FlashcardDraft[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? (json as { cards?: unknown }).cards : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const cards: FlashcardDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const front = clean((item as Record<string, unknown>).front, MAX_FRONT);
    const back = clean((item as Record<string, unknown>).back, MAX_BACK);
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    cards.push({ front, back });
    if (cards.length >= max) break;
  }
  return cards;
}

/** Takes whole sources in order while they fit the budget (the first one always, cut to fit). */
export function sourcesWithinBudget(sources: FlashcardSource[], budget = FLASHCARD_SOURCE_BUDGET): FlashcardSource[] {
  const kept: FlashcardSource[] = [];
  let used = 0;
  for (const s of sources) {
    const text = s.text.trim();
    if (!text) continue;
    if (kept.length === 0 && text.length > budget) return [{ label: s.label, text: text.slice(0, budget) }];
    if (used + text.length > budget) break;
    kept.push({ label: s.label, text });
    used += text.length;
  }
  return kept;
}

/**
 * Quizlet's import box ("Import from Word, Excel, Google Docs, etc.") with
 * its default settings: a tab between term and definition, one card per
 * line. Tabs and line breaks inside a card would split it, so they become
 * spaces.
 */
export function quizletImportText(cards: FlashcardDraft[]): string {
  const flat = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return cards.map((c) => `${flat(c.front)}\t${flat(c.back)}`).join("\n");
}

export const QUIZLET_CREATE_URL = "https://quizlet.com/create-set";

/** chatgpt.com with a request typed in. ChatGPT reads ?q= but doesn't document it, so at worst it opens a blank chat. */
export function chatgptUrl(prompt: string): string {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

/** The requests "Study with ChatGPT" offers for a class. Each names Campus OS so ChatGPT uses the connected account. */
export function chatgptStudyPrompts(input: { className: string; nextExam?: string | null; latestLecture?: string | null }) {
  const c = input.className;
  const prompts = [
    {
      label: "Quiz me",
      prompt: `Use my Campus OS notes for ${c} to quiz me. Ask 10 questions one at a time, wait for my answer, and tell me what I got wrong.`,
    },
    {
      label: input.nextExam ? `Study guide for ${input.nextExam}` : "Make a study guide",
      prompt: input.nextExam
        ? `Use my Campus OS notes and course files for ${c} to make a study guide for ${input.nextExam}, with the most important topics first.`
        : `Use my Campus OS notes and course files for ${c} to make a study guide, with the most important topics first.`,
    },
  ];
  if (input.latestLecture) {
    prompts.push({
      label: "Explain my latest lecture",
      prompt: `Use my Campus OS lecture notes for ${c} to explain "${input.latestLecture}" simply, then check my understanding with 3 questions.`,
    });
  }
  return prompts;
}

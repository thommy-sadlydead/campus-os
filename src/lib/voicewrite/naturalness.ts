/**
 * Deterministic, local text-craft analysis - sentence rhythm, repeated
 * openers, contraction usage, and common AI-sounding filler phrases.
 * This is NOT an AI detector and doesn't claim to be: everything here is a
 * plain, countable property of the text itself, computed entirely in the
 * browser. It's meant to help you spot why something reads stiffly, not to
 * score or guarantee anything about how a third-party tool would judge it.
 */

export interface NaturalnessCheck {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  shortestSentence: number;
  longestSentence: number;
  lengthVariety: "low" | "moderate" | "good";
  contractionCount: number;
  repeatedOpeners: { word: string; count: number }[];
  flaggedPhrases: { phrase: string; count: number }[];
}

// Commonly-cited "AI-sounding" filler phrases and stock transitions. Flagging
// a hit here is informational, not a verdict - plenty of genuine human
// writing uses these too.
export const WATCHED_PHRASES = [
  "in today's fast-paced world",
  "in today's digital age",
  "in this day and age",
  "it is important to note that",
  "it's important to note that",
  "it is worth noting",
  "as previously mentioned",
  "in conclusion",
  "in summary",
  "furthermore",
  "moreover",
  "delve into",
  "dive into",
  "unlock the potential",
  "unlock your potential",
  "in the realm of",
  "when it comes to",
  "at the end of the day",
  "needless to say",
  "game changer",
  "game-changer",
  "cutting-edge",
  "seamless",
  "seamlessly",
  "robust",
  "leverage",
  "utilize",
  "landscape",
  "tapestry",
  "boasts",
  "paramount",
  "foster",
  "embark on",
  "navigate",
  "testament to",
  "underscore",
  "meticulous",
  "showcase",
  "showcasing",
  "commendable",
  "surpass",
  "intricate",
  "pivotal",
  "resonate",
  "compelling",
  "unwavering",
  "groundbreaking",
  "synergy",
  "holistic",
  "transformative",
  "myriad",
  "elevate",
  "multifaceted",
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function analyzeNaturalness(rawText: string): NaturalnessCheck | null {
  const text = rawText.trim();
  if (!text) return null;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;

  const lengths = sentences.map((s) => wordsOf(s).length);
  const wordCount = wordsOf(text).length;
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);

  let lengthVariety: NaturalnessCheck["lengthVariety"] = "good";
  if (sentences.length >= 3) {
    const spread = longest - shortest;
    if (spread < avg * 0.3) lengthVariety = "low";
    else if (spread < avg * 0.6) lengthVariety = "moderate";
  }

  const contractionCount = (text.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/gi) || []).length;

  const openerCounts = new Map<string, number>();
  for (const s of sentences) {
    const first = wordsOf(s)[0]?.toLowerCase().replace(/[^a-z']/g, "");
    if (!first || first.length < 3) continue;
    openerCounts.set(first, (openerCounts.get(first) ?? 0) + 1);
  }
  const repeatedOpeners = [...openerCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const flaggedPhrases = WATCHED_PHRASES.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    const count = (text.match(re) || []).length;
    return { phrase, count };
  })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    wordCount,
    sentenceCount: sentences.length,
    avgSentenceLength: Math.round(avg * 10) / 10,
    shortestSentence: shortest,
    longestSentence: longest,
    lengthVariety,
    contractionCount,
    repeatedOpeners,
    flaggedPhrases,
  };
}

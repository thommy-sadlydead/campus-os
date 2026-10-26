"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { askClaudeForJson, getAnthropicClient } from "@/lib/anthropic";
import { AI_LIMIT_MESSAGE, allowAiRequest } from "@/lib/rate-limit";
import { AI_CONSENT_MESSAGE, hasAiConsent } from "@/lib/ai-consent";
import { MATERIALS_WITH_TEXT } from "@/lib/class-context";
import { classMaterialTypeLabel } from "@/lib/lecture-notes";
import {
  FLASHCARD_COUNTS,
  buildFlashcardPrompt,
  parseFlashcards,
  sourcesWithinBudget,
  type FlashcardSource,
} from "@/lib/flashcards";

// The Study tab's flashcards. Every action checks the class or card belongs
// to the signed-in student: like every server action, these can be called
// with any arguments.

export type StudyActionResult = { error?: string; deckId?: string } | undefined;

const generateSchema = z.object({
  // "all", or one note or course file: "note:<id>" / "material:<id>".
  source: z.string().regex(/^(all|note:[\w-]{1,64}|material:[\w-]{1,64})$/),
  count: z.number().refine((n) => (FLASHCARD_COUNTS as readonly number[]).includes(n)),
  focus: z.string().trim().max(80).optional(),
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function sourcesFor(classId: string, source: string): Promise<{ sources: FlashcardSource[]; title: string; description: string } | null> {
  if (source.startsWith("note:")) {
    const note = await prisma.note.findFirst({ where: { id: source.slice(5), section: { classId } } });
    if (!note?.bodyMarkdown.trim()) return null;
    return { sources: [{ label: note.title, text: note.bodyMarkdown }], title: note.title, description: note.lectureId ? "From lecture notes" : "From a note" };
  }
  if (source.startsWith("material:")) {
    const m = await prisma.classMaterial.findFirst({ where: { id: source.slice(9), classId, ...MATERIALS_WITH_TEXT } });
    if (!m?.content.trim()) return null;
    return { sources: [{ label: `${classMaterialTypeLabel(m.type)}: ${m.title}`, text: m.content }], title: m.title, description: "From a course file" };
  }

  // Everything: pinned notes, then lecture notes and other notes newest
  // first, then course files, as much as fits.
  const [notes, materials] = await Promise.all([
    prisma.note.findMany({
      where: { section: { classId }, NOT: { bodyMarkdown: "" } },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.classMaterial.findMany({ where: { classId, ...MATERIALS_WITH_TEXT }, orderBy: { createdAt: "desc" } }),
  ]);
  const all: FlashcardSource[] = [
    ...notes.map((n) => ({ label: n.lectureId ? `Lecture notes: ${n.title}` : `Note: ${n.title}`, text: n.bodyMarkdown })),
    ...materials.map((m) => ({ label: `${classMaterialTypeLabel(m.type)}: ${m.title}`, text: m.content })),
  ];
  const sources = sourcesWithinBudget(all);
  if (sources.length === 0) return null;
  const noteCount = sources.filter((s) => s.label.startsWith("Note:") || s.label.startsWith("Lecture notes:")).length;
  const fileCount = sources.length - noteCount;
  const parts = [noteCount ? plural(noteCount, "note") : null, fileCount ? plural(fileCount, "course file") : null].filter(Boolean);
  return { sources, title: "Everything so far", description: `From ${parts.join(" and ")}` };
}

export async function generateFlashcardsAction(
  classId: string,
  input: { source: string; count: number; focus?: string }
): Promise<StudyActionResult> {
  const user = await requireUser();
  const cls = await prisma.class.findFirst({ where: { id: classId, userId: user.id }, select: { id: true, name: true } });
  if (!cls) return { error: "That class wasn't found." };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick what to make the cards from and how many." };

  if (!hasAiConsent(user)) return { error: AI_CONSENT_MESSAGE };
  const material = await sourcesFor(cls.id, parsed.data.source);
  if (!material) {
    return {
      error:
        parsed.data.source === "all"
          ? "There's nothing to make cards from yet. Add notes, record a lecture, or add course files first."
          : "That note or file has no text to make cards from.",
    };
  }
  if (!(await allowAiRequest(user.id))) return { error: AI_LIMIT_MESSAGE };

  const focus = parsed.data.focus || null;
  const { system, prompt } = buildFlashcardPrompt({ className: cls.name, sources: material.sources, count: parsed.data.count, focus });
  const json = await askClaudeForJson<unknown>({ system, prompt, maxTokens: 6000 });
  const cards = parseFlashcards(json, parsed.data.count);
  if (cards.length < 3) {
    return {
      error: getAnthropicClient()
        ? "Couldn't make flashcards just now. Try again in a moment."
        : "AI features aren't set up on this site, so flashcards can't be made here.",
    };
  }

  const deck = await prisma.flashcardDeck.create({
    data: {
      classId: cls.id,
      title: focus ? focus.charAt(0).toUpperCase() + focus.slice(1) : material.title,
      source: material.description,
      cards: { create: cards.map((c, i) => ({ front: c.front, back: c.back, order: i })) },
    },
  });
  revalidatePath(`/classes/${cls.id}`);
  return { deckId: deck.id };
}

async function ownedDeck(deckId: string, userId: string) {
  return prisma.flashcardDeck.findFirst({ where: { id: deckId, class: { userId } }, select: { id: true, classId: true } });
}

export async function setFlashcardKnownAction(cardId: string, known: boolean): Promise<void> {
  const user = await requireUser();
  await prisma.flashcard.updateMany({ where: { id: cardId, deck: { class: { userId: user.id } } }, data: { known: Boolean(known) } });
}

export async function resetDeckProgressAction(deckId: string): Promise<void> {
  const user = await requireUser();
  const deck = await ownedDeck(deckId, user.id);
  if (!deck) return;
  await prisma.flashcard.updateMany({ where: { deckId: deck.id }, data: { known: false } });
  revalidatePath(`/classes/${deck.classId}`);
}

export async function deleteDeckAction(deckId: string): Promise<void> {
  const user = await requireUser();
  const deck = await ownedDeck(deckId, user.id);
  if (!deck) return;
  await prisma.flashcardDeck.delete({ where: { id: deck.id } });
  revalidatePath(`/classes/${deck.classId}`);
}

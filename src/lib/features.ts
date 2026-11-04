// The features a student can turn on or off (at sign-up, and under
// Account → Features), so Campus OS shows only what they use. Pure, so the
// rules are easy to test; the picker, the navigation and each page read
// the same list.
//
// The core (classes, assignments, the Today list, schedule, notes, exams,
// course files, LMS connections) is always on and isn't listed here.

export const FEATURE_IDS = [
  "lectures",
  "flashcards",
  "smart-review",
  "exam-prep",
  "assistant",
  "tutor-mode",
  "breakdown",
  "grades",
  "get-help",
  "risk",
  "free-time",
  "commitments",
  "email",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export type FeatureGroup = "Lectures and studying" | "AI help" | "Staying on track";

export interface FeatureInfo {
  id: FeatureId;
  name: string;
  description: string;
  group: FeatureGroup;
  /** Added with the picker (November 2026), so accounts from before don't have it yet. */
  isNew: boolean;
  /** Sends the student's data to an AI service, so it also needs AI permission (src/lib/ai-consent.ts). */
  usesAi: boolean;
  /** Only works with these on; the picker turns them on together. */
  requires?: FeatureId[];
}

export const FEATURES: FeatureInfo[] = [
  {
    id: "lectures",
    name: "Lecture recording and notes",
    description: "Record class, or upload a recording, and get organized notes from it.",
    group: "Lectures and studying",
    isNew: false,
    usesAi: true,
  },
  {
    id: "flashcards",
    name: "Flashcards",
    description: "Make flashcards from your notes, lectures and course files. Study them here or copy them to Quizlet.",
    group: "Lectures and studying",
    isNew: false,
    usesAi: true,
  },
  {
    id: "smart-review",
    name: "Smart review",
    description:
      "Cards you miss come back sooner and ones you know come back later, and each lecture's notes end with a few questions to test yourself.",
    group: "Lectures and studying",
    isNew: true,
    usesAi: false,
    requires: ["flashcards"],
  },
  {
    id: "exam-prep",
    name: "Exam prep plans",
    description: "Before an exam, get a few short quiz sessions spread over the days before it, fit around your classes and work.",
    group: "Lectures and studying",
    isNew: true,
    usesAi: true,
    requires: ["flashcards"],
  },
  {
    id: "assistant",
    name: "Class assistant",
    description: "Ask questions about a class, get a study guide, or ask about everything at once from Today.",
    group: "AI help",
    isNew: false,
    usesAi: true,
  },
  {
    id: "tutor-mode",
    name: "Tutor mode",
    description: "For homework questions, the class assistant gives hints and asks questions instead of handing over answers.",
    group: "AI help",
    isNew: true,
    usesAi: true,
    requires: ["assistant"],
  },
  {
    id: "breakdown",
    name: "Assignment breakdown",
    description: "Split a big assignment into smaller steps with time estimates.",
    group: "AI help",
    isNew: false,
    usesAi: true,
  },
  {
    id: "grades",
    name: "Grades",
    description: "Your current grade in each class, what you need on the final, and a heads-up when a grade starts slipping.",
    group: "Staying on track",
    isNew: true,
    usesAi: false,
  },
  {
    id: "get-help",
    name: "Getting help",
    description: "Office hours, a ready-to-send email to your professor, and links to tutoring and other help at your school.",
    group: "Staying on track",
    isNew: true,
    usesAi: false,
  },
  {
    id: "risk",
    name: "On track or behind",
    description: "A daily check of whether you're on track, getting behind or at risk, and what to do first.",
    group: "Staying on track",
    isNew: false,
    usesAi: false,
  },
  {
    id: "free-time",
    name: "Free time today",
    description: "Log the time you have free today to see whether it covers what's due.",
    group: "Staying on track",
    isNew: false,
    usesAi: false,
  },
  {
    id: "commitments",
    name: "Work and other commitments",
    description: "Add work shifts, practice and other weekly plans, and set the latest you want to study, so plans stay realistic.",
    group: "Staying on track",
    isNew: true,
    usesAi: false,
  },
  {
    id: "email",
    name: "Email changes",
    description: "Catch due-date and room changes your professors send to your school Gmail.",
    group: "Staying on track",
    isNew: false,
    usesAi: true,
  },
];

export const FEATURE_GROUPS: FeatureGroup[] = ["Lectures and studying", "AI help", "Staying on track"];

/** What's always there, for the picker to show it isn't going anywhere. */
export const CORE_FEATURES = [
  "Today's ranked to-do list",
  "Classes, assignments and exams from your school",
  "Schedule and class times",
  "Notes",
  "Course files",
];

/** Every feature an account had before the picker existed: what it keeps until it picks. */
export const LEGACY_FEATURES: FeatureId[] = FEATURES.filter((f) => !f.isNew).map((f) => f.id);

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function featureInfo(id: FeatureId): FeatureInfo {
  return BY_ID.get(id) as FeatureInfo;
}

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && BY_ID.has(value as FeatureId);
}

/**
 * The features to keep from a submitted or stored list: known ids once
 * each, in FEATURES order, without any whose requirements are missing (so
 * turning off Flashcards turns off Smart review too). `available` limits
 * it to what this account can have (Email only for Gmail testers).
 */
export function normalizeFeatures(values: unknown[], available: (id: FeatureId) => boolean = () => true): FeatureId[] {
  const picked = new Set(values.filter(isFeatureId).filter(available));
  return FEATURES.map((f) => f.id).filter((id) => picked.has(id) && (featureInfo(id).requires ?? []).every((r) => picked.has(r)));
}

/** The features to show the picker as checked when `id` is toggled: requirements come along, dependents go. */
export function toggleFeature(current: FeatureId[], id: FeatureId, on: boolean): FeatureId[] {
  const next = new Set(current);
  if (on) {
    next.add(id);
    for (const r of featureInfo(id).requires ?? []) next.add(r);
  } else {
    next.delete(id);
    for (const f of FEATURES) if (f.requires?.includes(id)) next.delete(f.id);
  }
  return normalizeFeatures([...next]);
}

export interface FeatureUser {
  features: string[];
  featuresChosenAt: Date | null;
}

/**
 * The features an account has on. Until it picks, an account keeps
 * everything it had before the picker (LEGACY_FEATURES), and the App
 * Store review account has everything, so a reviewer can try it all.
 */
export function enabledFeatures(user: FeatureUser, options: { demo?: boolean } = {}): Set<FeatureId> {
  if (!user.featuresChosenAt) return new Set(options.demo ? FEATURE_IDS : LEGACY_FEATURES);
  return new Set(normalizeFeatures(user.features));
}

// What the class page hands the Study tab. A plain module (no "use client")
// so the server page can build these.

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  known: boolean;
}

export interface StudyDeck {
  id: string;
  title: string;
  /** What it was made from: "From 6 notes and 2 course files". */
  source: string;
  createdAt: string;
  cards: StudyCard[];
}

export interface StudySourceOption {
  value: string;
  label: string;
  group: "Notes" | "Lecture notes" | "Course files";
}

export interface ChatGptStudyInfo {
  /** The student has connected Campus OS in ChatGPT (an active OAuth grant). */
  connected: boolean;
  /** The plugin's ChatGPT directory page (CHATGPT_PLUGIN_URL), once it's published. */
  connectUrl: string | null;
  prompts: { label: string; prompt: string }[];
}

// Getting help in a class (src/lib/features.ts): a prewritten email to the
// professor, and links to the help most schools have. Pure, so it's easy
// to test.
//
// First-generation students use office hours and similar "unwritten rule"
// help the least, and the gap closes once they're told it's there and how
// to use it. So this makes the ask concrete: when, who, and what to say.

export type HelpReason = "question" | "grade" | "exam" | "missed";

export const HELP_REASONS: { value: HelpReason; label: string }[] = [
  { value: "question", label: "A question about the material" },
  { value: "grade", label: "How I'm doing in the class" },
  { value: "exam", label: "Getting ready for an exam" },
  { value: "missed", label: "I missed class" },
];

export interface ProfessorEmailInput {
  reason: HelpReason;
  className: string;
  classCode: string | null;
  professor: string | null;
  studentName: string | null;
  officeHours: string | null;
  examName?: string | null;
}

/** "Dr. Smith" stays as is; "Jane Smith" becomes "Professor Smith"; nothing becomes "Professor". */
export function professorGreeting(professor: string | null): string {
  const name = professor?.trim();
  if (!name) return "Hello Professor,";
  if (/^(dr|prof|professor|mr|mrs|ms|mx)\.?\s/i.test(name)) return `Hello ${name},`;
  const last = name.split(/\s+/).pop();
  return `Hello Professor ${last},`;
}

/** A short, polite email the student edits and sends from their own mail app. */
export function professorEmailDraft(input: ProfessorEmailInput): { subject: string; body: string } {
  const course = input.classCode?.trim() ? `${input.classCode.trim()} (${input.className})` : input.className;
  const visit = input.officeHours?.trim()
    ? `Would it be all right if I came to your office hours (${input.officeHours.trim()})? If another time works better, I'm happy to find one.`
    : "Could I come by your office hours, or is there another time that works for you?";
  const exam = input.examName?.trim() || "the upcoming exam";

  const ask: Record<HelpReason, { subject: string; lines: string[] }> = {
    question: {
      subject: `Question about ${course}`,
      lines: [`I'm in your ${course} class and I'm having trouble with [the topic]. Specifically, [what's confusing].`, visit],
    },
    grade: {
      subject: `Checking in about my grade in ${course}`,
      lines: [
        `I'm in your ${course} class, and I'd like to do better than I'm doing right now.`,
        "Could we talk about where I'm losing points and what I should focus on?",
        visit,
      ],
    },
    exam: {
      subject: `Preparing for ${exam} in ${course}`,
      lines: [
        `I'm in your ${course} class and getting ready for ${exam}.`,
        "Are there topics you'd suggest I focus on, or practice problems you'd recommend?",
        visit,
      ],
    },
    missed: {
      subject: `Missed class in ${course}`,
      lines: [
        `I'm in your ${course} class, and I missed class on [day] because [reason].`,
        "Is there anything I should catch up on beyond the posted materials?",
      ],
    },
  };

  const { subject, lines } = ask[input.reason];
  const signOff = input.studentName?.trim() ? `Thank you,\n${input.studentName.trim()}` : "Thank you,\n[Your name]";
  return { subject, body: [professorGreeting(input.professor), "", ...lines.flatMap((l) => [l, ""]), signOff].join("\n") };
}

/** The school's web address from a student's email, when it's a school address ("cedarville.edu"). */
export function schoolDomainFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain || !/\.edu$/.test(domain)) return null;
  // "students.cedarville.edu" → "cedarville.edu", so searches find the main site.
  const parts = domain.split(".");
  return parts.slice(-2).join(".");
}

export const CAMPUS_HELP_TOPICS = [
  { label: "Tutoring", query: "tutoring center" },
  { label: "Writing center", query: "writing center" },
  { label: "Counseling", query: "counseling center" },
  { label: "Disability services", query: "disability services accommodations" },
  { label: "Food and housing help", query: "food pantry basic needs" },
];

/**
 * Searches of the student's school site for each kind of help: Campus OS
 * doesn't know each school's pages, so it doesn't pretend to. Empty when
 * the student's email isn't a school address.
 */
export function campusHelpLinks(email: string): { label: string; url: string }[] {
  const domain = schoolDomainFromEmail(email);
  if (!domain) return [];
  return CAMPUS_HELP_TOPICS.map((t) => ({
    label: t.label,
    url: `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${t.query}`)}`,
  }));
}

/** What to look for in a syllabus, for the "Find in syllabus" button. */
export const SYLLABUS_HELP_SYSTEM = [
  "You read a course syllabus and pull out how to reach the instructor.",
  'Return JSON: {"professorEmail": string | null, "officeHours": string | null}.',
  "professorEmail: the instructor's own email address exactly as written, or null. Not a TA's, a department's or a generic address.",
  'officeHours: the instructor\'s office hours and where they are, as one short line (e.g. "Tue and Thu 2–3:30 PM, Science Center 210"), or null.',
  "Only use what the syllabus says. Never guess.",
].join(" ");

/** Keeps only plausible values from the model's answer. */
export function parseSyllabusHelp(json: unknown): { professorEmail: string | null; officeHours: string | null } {
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const email = typeof obj.professorEmail === "string" ? obj.professorEmail.trim() : "";
  const hours = typeof obj.officeHours === "string" ? obj.officeHours.trim().replace(/\s+/g, " ") : "";
  return {
    professorEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : null,
    officeHours: hours && hours.length <= 200 ? hours : null,
  };
}

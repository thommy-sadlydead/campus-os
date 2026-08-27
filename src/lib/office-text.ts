import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { ENTITY_MAP, htmlToReadableText } from "./text";

/**
 * pptx/docx are both zip archives of XML (Office Open XML). Rather than add
 * a full XML-parser dependency, this reuses the same regex-extraction
 * philosophy as text.ts's stripHtml: pull out paragraph elements, then the
 * text runs inside each. Runs within one paragraph are joined with "" (a
 * single word is often split across runs mid-formatting-change, e.g. bold
 * starting partway through — joining with a space would wrongly split
 * words), while paragraphs are joined with "\n" to keep line structure.
 */
function extractOoxmlText(xml: string, paragraphTag: string, textTag: string): string {
  const paragraphPattern = new RegExp(`<${paragraphTag}[ >][\\s\\S]*?</${paragraphTag}>`, "g");
  const textPattern = new RegExp(`<${textTag}[^>]*>([\\s\\S]*?)</${textTag}>`, "g");

  const paragraphs = xml.match(paragraphPattern) ?? [xml];
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const runs: string[] = [];
    let match: RegExpExecArray | null;
    textPattern.lastIndex = 0;
    while ((match = textPattern.exec(paragraph)) !== null) {
      runs.push(match[1]);
    }
    const line = runs
      .join("")
      .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
      .trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));

  const slides: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    const text = extractOoxmlText(xml, "a:p", "a:t");
    if (text) slides.push(text);
  }
  return slides.join("\n\n");
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  return extractOoxmlText(xml, "w:p", "w:t");
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const EXTENSION_BY_TYPE: Array<{ test: (contentType: string, filename: string) => boolean; kind: "pdf" | "pptx" | "docx" | "text" | "html" }> = [
  { test: (t, f) => t.includes("pdf") || f.endsWith(".pdf"), kind: "pdf" },
  { test: (t, f) => t.includes("presentationml") || f.endsWith(".pptx"), kind: "pptx" },
  { test: (t, f) => t.includes("wordprocessingml") || f.endsWith(".docx"), kind: "docx" },
  { test: (t, f) => t.includes("text/html") || f.endsWith(".html") || f.endsWith(".htm"), kind: "html" },
  { test: (t, f) => t.includes("text/plain") || f.endsWith(".txt"), kind: "text" },
];

/**
 * Best-effort text extraction across the document types Canvas-hosted
 * lecture materials actually show up as. Returns null for anything not
 * recognized (old .ppt/.doc binary formats, images, zips, etc.) so the
 * caller can give an honest "can't read this yet" error instead of storing
 * garbage or a misleading empty result.
 */
export async function extractDocumentText(buffer: Buffer, contentType: string, filename: string): Promise<string | null> {
  const type = contentType.toLowerCase();
  const name = filename.toLowerCase();
  const match = EXTENSION_BY_TYPE.find((entry) => entry.test(type, name));
  if (!match) return null;

  switch (match.kind) {
    case "pdf":
      return extractPdfText(buffer);
    case "pptx":
      return extractPptxText(buffer);
    case "docx":
      return extractDocxText(buffer);
    case "html":
      return htmlToReadableText(buffer.toString("utf-8"));
    case "text":
      return buffer.toString("utf-8");
  }
}

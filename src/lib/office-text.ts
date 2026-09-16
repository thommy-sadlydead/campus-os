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

/**
 * Resolves an EPUB manifest href (relative to the OPF package file's own
 * directory, not the zip root) into a path usable with JSZip's flat file
 * map. EPUB manifests don't typically use "../", but this handles it
 * defensively rather than assuming.
 */
function resolveEpubPath(opfPath: string, href: string): string {
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const parts = (baseDir + href).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

/**
 * EPUB is a zip of XHTML (same shape as pptx/docx), but reading order
 * isn't "files in some natural order" — it's defined by the OPF package
 * document's <spine>, which references <manifest> items by id. Container
 * -> OPF -> manifest (id -> href) -> spine (reading order of ids) -> read
 * each XHTML file in that order and reuse htmlToReadableText on each,
 * same as any other web page.
 */
export async function extractEpubText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return "";
  const containerXml = await containerFile.async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) return "";

  const opfFile = zip.file(opfPath);
  if (!opfFile) return "";
  const opfXml = await opfFile.async("string");

  const manifest = new Map<string, string>();
  const itemPattern = /<item\b[^>]*>/g;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemPattern.exec(opfXml)) !== null) {
    const tag = itemMatch[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const mediaType = tag.match(/\bmedia-type="([^"]+)"/)?.[1];
    if (id && href && mediaType && /html/i.test(mediaType)) {
      manifest.set(id, href);
    }
  }

  const spineIds: string[] = [];
  const itemrefPattern = /<itemref\b[^>]*>/g;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefPattern.exec(opfXml)) !== null) {
    const idref = refMatch[0].match(/\bidref="([^"]+)"/)?.[1];
    if (idref) spineIds.push(idref);
  }

  const sections: string[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const contentFile = zip.file(resolveEpubPath(opfPath, href));
    if (!contentFile) continue;
    const html = await contentFile.async("string");
    const text = htmlToReadableText(html);
    if (text) sections.push(text);
  }

  return sections.join("\n\n");
}

const EXTENSION_BY_TYPE: Array<{
  test: (contentType: string, filename: string) => boolean;
  kind: "pdf" | "pptx" | "docx" | "epub" | "text" | "html";
}> = [
  { test: (t, f) => t.includes("pdf") || f.endsWith(".pdf"), kind: "pdf" },
  { test: (t, f) => t.includes("presentationml") || f.endsWith(".pptx"), kind: "pptx" },
  { test: (t, f) => t.includes("wordprocessingml") || f.endsWith(".docx"), kind: "docx" },
  { test: (t, f) => t.includes("epub") || f.endsWith(".epub"), kind: "epub" },
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
    case "epub":
      return extractEpubText(buffer);
    case "html":
      return htmlToReadableText(buffer.toString("utf-8"));
    case "text":
      return buffer.toString("utf-8");
  }
}

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractPptxText, extractDocxText } from "../src/lib/office-text";

async function buildPptx(slideXmls: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slideXmls.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

const SLIDE_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

describe("extractPptxText", () => {
  it("extracts text runs from each paragraph, one line per paragraph", async () => {
    const slide = `<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody>
      <a:p><a:r><a:t>Title Slide</a:t></a:r></a:p>
      <a:p><a:r><a:t>First bullet point</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const buffer = await buildPptx([slide]);
    const text = await extractPptxText(buffer);
    expect(text).toBe("Title Slide\nFirst bullet point");
  });

  it("joins multiple runs within one paragraph without inserting spaces (mid-word formatting changes)", async () => {
    const slide = `<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody>
      <a:p><a:r><a:t>Photo</a:t></a:r><a:r><a:t>synthesis</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const buffer = await buildPptx([slide]);
    const text = await extractPptxText(buffer);
    expect(text).toBe("Photosynthesis");
  });

  it("orders slides numerically (slide2 before slide10), separated by blank lines", async () => {
    const makeSlide = (label: string) =>
      `<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${label}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", makeSlide("Slide Two"));
    zip.file("ppt/slides/slide10.xml", makeSlide("Slide Ten"));
    zip.file("ppt/slides/slide1.xml", makeSlide("Slide One"));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const text = await extractPptxText(buffer);
    expect(text).toBe("Slide One\n\nSlide Two\n\nSlide Ten");
  });

  it("decodes HTML entities in slide text", async () => {
    const slide = `<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody>
      <a:p><a:r><a:t>Supply &amp; Demand</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const buffer = await buildPptx([slide]);
    const text = await extractPptxText(buffer);
    expect(text).toBe("Supply & Demand");
  });
});

describe("extractDocxText", () => {
  it("extracts one line per paragraph from word/document.xml", async () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p><w:r><w:t>Introduction to the topic.</w:t></w:r></w:p>
    </w:body></w:document>`;
    const buffer = await buildDocx(xml);
    const text = await extractDocxText(buffer);
    expect(text).toBe("Chapter 1\nIntroduction to the topic.");
  });

  it("returns an empty string when there's no word/document.xml", async () => {
    const zip = new JSZip();
    zip.file("some-other-file.xml", "<x/>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const text = await extractDocxText(buffer);
    expect(text).toBe("");
  });
});

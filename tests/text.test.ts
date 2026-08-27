import { describe, it, expect } from "vitest";
import { htmlToReadableText, extractHtmlTitle } from "../src/lib/text";

describe("htmlToReadableText", () => {
  it("strips tags and keeps the readable text", () => {
    const html = "<html><body><h1>Title</h1><p>Some content here.</p></body></html>";
    expect(htmlToReadableText(html)).toBe("Title\nSome content here.");
  });

  it("removes script, style, and nav/header/footer blocks entirely", () => {
    const html = `
      <nav>Home | About</nav>
      <header>Site Header</header>
      <script>trackEvent("pageview");</script>
      <style>.foo { color: red; }</style>
      <main><p>The real article text.</p></main>
      <aside>Related links</aside>
      <footer>Copyright 2026</footer>
    `;
    const result = htmlToReadableText(html);
    expect(result).toBe("The real article text.");
    expect(result).not.toContain("trackEvent");
    expect(result).not.toContain("color: red");
    expect(result).not.toContain("Home | About");
    expect(result).not.toContain("Copyright");
  });

  it("decodes HTML entities", () => {
    const html = "<p>Rock &amp; Roll &mdash;&nbsp;an intro</p>".replace("&mdash;", "&#8212;");
    const result = htmlToReadableText(html);
    expect(result).toContain("Rock & Roll");
  });

  it("collapses runs of whitespace-only nested divs into a single blank line, not many", () => {
    const emptyDivs = Array.from({ length: 30 }, () => "<div> </div>").join("");
    const html = `${emptyDivs}<p>Real content.</p>`;
    const result = htmlToReadableText(html);
    expect(result).toBe("Real content.");
  });
});

describe("extractHtmlTitle", () => {
  it("extracts the <title> tag content", () => {
    const html = "<html><head><title>My Page Title</title></head><body></body></html>";
    expect(extractHtmlTitle(html)).toBe("My Page Title");
  });

  it("decodes entities in the title", () => {
    const html = "<title>Fish &amp; Chips</title>";
    expect(extractHtmlTitle(html)).toBe("Fish & Chips");
  });

  it("returns null when there is no title tag", () => {
    expect(extractHtmlTitle("<html><body><p>No title here</p></body></html>")).toBeNull();
  });

  it("returns null for an empty title tag", () => {
    expect(extractHtmlTitle("<title></title>")).toBeNull();
  });
});

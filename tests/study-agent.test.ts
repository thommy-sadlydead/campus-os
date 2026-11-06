import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { capText, rankSearchResults, readChunk, searchTerms, type SearchCandidate } from "../src/lib/study-agent/text";
import { runStudyAgent } from "../src/lib/study-agent/agent";
import { StudyToolError, studyTools } from "../src/lib/study-agent/tools";

describe("searchTerms", () => {
  it("keeps topic words and quoted phrases, drops filler, keeps numbers", () => {
    expect(searchTerms('help me study for my quiz on "chapter 3" mitosis and the cell cycle')).toEqual([
      "chapter 3",
      "mitosis",
      "cell",
      "cycle",
    ]);
    expect(searchTerms("Week 5 enzymes")).toEqual(["5", "enzymes"]);
  });

  it("caps the number of terms", () => {
    expect(searchTerms("alpha beta gamma delta epsilon zeta eta theta")).toHaveLength(6);
  });
});

describe("rankSearchResults", () => {
  const base = { subtype: null, classId: "c1", className: "Biology", chars: 1000 };
  const candidates: SearchCandidate[] = [
    { ...base, kind: "material", id: "m1", title: "Syllabus", titleHits: [false, false], snippets: ["the enzyme unit", null] },
    { ...base, kind: "lecture", id: "l1", title: "Enzymes and kinetics", titleHits: [true, true], snippets: ["enzyme rates", "kinetics are"] },
    { ...base, kind: "note", id: "n1", title: "Lab notes", titleHits: [false, false], snippets: [null, null] },
  ];

  it("puts the item matching the most terms (and in its title) first, and drops non-matches", () => {
    const ranked = rankSearchResults(["enzyme", "kinetics"], candidates, 10);
    expect(ranked.map((r) => r.id)).toEqual(["l1", "m1"]);
    expect(ranked[0].matched).toEqual(["enzyme", "kinetics"]);
    expect(ranked[0].snippet).toBe("…enzyme rates… …kinetics are…");
  });

  it("doesn't repeat a stretch two nearby terms both landed in", () => {
    const stretch = "the chain rule handles a composition: a function inside another function";
    const [r] = rankSearchResults(["chain", "rule"], [{ ...base, kind: "lecture", id: "l2", title: "Week 3", titleHits: [false, false], snippets: [stretch, stretch] }], 5);
    expect(r.snippet).toBe(`…${stretch}…`);
  });
});

describe("readChunk", () => {
  it("reads in pieces, ending at a line break near the end, and says where to continue", () => {
    const text = `${"a".repeat(80)}\n${"b".repeat(40)}`;
    const first = readChunk(text, 0, 100);
    expect(first.text).toBe(`${"a".repeat(80)}\n`);
    expect(first.nextOffset).toBe(81);
    const second = readChunk(text, first.nextOffset!, 100);
    expect(second).toEqual({ text: "b".repeat(40), nextOffset: null });
  });

  it("caps long tool results and says so", () => {
    expect(capText("abcdef", 3)).toBe("abc\n[…cut at 3 characters]");
    expect(capText("abc", 3)).toBe("abc");
  });
});

describe("studyTools", () => {
  const scope = { userId: "u1", tz: "America/New_York", now: new Date("2026-11-05T20:00:00Z") };

  it("offers list_classes only outside a class, and every tool is strict", () => {
    const everywhere = studyTools(scope).map((t) => t.name);
    const inClass = studyTools({ ...scope, classId: "c1" }).map((t) => t.name);
    expect(everywhere).toContain("list_classes");
    expect(inClass).not.toContain("list_classes");
    for (const t of studyTools(scope)) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

// A stand-in for the Messages API: answers each request with the next
// scripted response, and keeps what it was sent.
function scriptedClient(responses: Partial<Anthropic.Beta.BetaMessage>[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        create: async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
          requests.push(structuredClone(params));
          const r = responses[Math.min(i++, responses.length - 1)];
          return { stop_reason: "end_turn", content: [], ...r } as Anthropic.Beta.BetaMessage;
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">;
  return { client, requests };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const text = (t: string) => ({ type: "text" as const, text: t, citations: null });
const scope = { userId: "u1", tz: "America/New_York", now: new Date("2026-11-05T20:00:00Z") };

describe("runStudyAgent", () => {
  it("looks things up, sends every result back in one message, then answers with what it read", async () => {
    const thinking = { type: "thinking" as const, thinking: "", signature: "sig" };
    const { client, requests } = scriptedClient([
      { stop_reason: "tool_use", content: [thinking, toolUse("t1", "find_upcoming_work", { days_ahead: 2, days_back: 0, class_id: null, include_done: false })] },
      {
        stop_reason: "tool_use",
        content: [
          toolUse("t2", "get_work_item", { kind: "assignment", id: "a1" }),
          toolUse("t3", "read_class_content", { kind: "lecture", id: "l1", offset: 0 }),
        ],
      },
      { stop_reason: "end_turn", content: [text("## Quiz 4 study guide\n- Enzymes lower activation energy")] },
    ]);
    const calls: string[] = [];
    const runTool = async (name: string) => {
      calls.push(name);
      if (name === "get_work_item") return JSON.stringify({ name: "Quiz 4", directions: "Covers lecture 6" });
      if (name === "read_class_content") return JSON.stringify({ title: "Lecture 6: Enzymes", text: "…" });
      return JSON.stringify({ items: [{ kind: "assignment", id: "a1", name: "Quiz 4" }] });
    };

    const result = await runStudyAgent("Help me study for my quiz tomorrow", scope, { client, runTool });

    expect(result).toEqual({ answer: "## Quiz 4 study guide\n- Enzymes lower activation energy", sources: ["Quiz 4", "Lecture 6: Enzymes"] });
    expect(calls).toEqual(["find_upcoming_work", "get_work_item", "read_class_content"]);
    expect(requests).toHaveLength(3);
    // The thinking block goes back exactly as it came, and both results share one user message.
    expect(requests[1].messages[1]).toEqual({ role: "assistant", content: [thinking, expect.objectContaining({ id: "t1" })] });
    const last = requests[2].messages.at(-1)!;
    expect(last.role).toBe("user");
    expect((last.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((b) => b.tool_use_id)).toEqual(["t2", "t3"]);
    // Model, effort and fallbacks on every request; nothing forced while there's room.
    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" }, fallbacks: "default" });
    expect(requests.every((r) => r.tool_choice === undefined)).toBe(true);
    expect((requests[0].messages[0].content as Anthropic.Beta.BetaTextBlockParam[])[0].text).toContain(
      "Question: Help me study for my quiz tomorrow"
    );
  });

  it("returns a tool's error to the model instead of failing", async () => {
    const { client, requests } = scriptedClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "get_work_item", { kind: "exam", id: "nope" })] },
      { stop_reason: "end_turn", content: [text("I couldn't find that exam.")] },
    ]);
    const result = await runStudyAgent("When is my exam?", scope, {
      client,
      runTool: async () => {
        throw new StudyToolError("No exam with that id.");
      },
    });
    expect(result?.answer).toBe("I couldn't find that exam.");
    const results = requests[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]).toMatchObject({ is_error: true, content: "No exam with that id." });
  });

  it("makes it answer with what it has once it runs out of time", async () => {
    let clock = 0;
    const { client, requests } = scriptedClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "list_classes", {})] },
      { stop_reason: "end_turn", content: [text("Here's what I found so far.")] },
    ]);
    const result = await runStudyAgent("Make me a study guide", scope, {
      client,
      runTool: async () => {
        clock += 200_000;
        return "[]";
      },
      now: () => clock,
    });
    expect(result?.answer).toBe("Here's what I found so far.");
    expect(requests[1].tool_choice).toEqual({ type: "none" });
  });

  it("says so when the request is declined, and gives up quietly when the API fails", async () => {
    const declined = scriptedClient([{ stop_reason: "refusal", content: [] }]);
    expect((await runStudyAgent("…", scope, { client: declined.client }))?.answer).toMatch(/can't help/);

    const failing = {
      beta: { messages: { create: async () => Promise.reject(new Error("overloaded")) } },
    } as unknown as Pick<Anthropic, "beta">;
    expect(await runStudyAgent("…", scope, { client: failing })).toBeNull();
    expect(await runStudyAgent("…", scope, { client: null })).toBeNull();
  });

  it("notes when the answer was cut off", async () => {
    const { client } = scriptedClient([{ stop_reason: "max_tokens", content: [text("## Long guide")] }]);
    expect((await runStudyAgent("…", scope, { client }))?.answer).toBe("## Long guide\n\n*(This got cut off. Ask for the rest.)*");
  });
});

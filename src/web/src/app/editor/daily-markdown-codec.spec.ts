import { describe, it, expect } from "vitest";
import { decodeDaily, encodeDaily } from "./daily-markdown-codec";
const prefix =
  '---\ntitle: My own title\nmaple:\n  format: 1\n  document: "document-1"\n  day: "2026-09-27"\n---\n';
const marker = (id: string, extra = {}) =>
  "<!-- maple:block " + JSON.stringify({ v: 1, id, ...extra }) + " -->\n";
describe("Daily Markdown codec", () => {
  it("round trips identity, source revision references, prose and user frontmatter", () => {
    const raw =
      prefix +
      "\n" +
      marker("heading") +
      "## Follow ups\n\n" +
      marker("text") +
      "Some **important** context.\n\n" +
      marker("source") +
      "```maple-ref\n" +
      JSON.stringify({
        v: 1,
        kind: "email",
        eventID: "immutable-revision",
        label: "Dominick <proposal>",
      }) +
      "\n```\n";
    const initial = decodeDaily(raw);
    expect(initial.sourceOnly).toBe(false);
    const result = decodeDaily(encodeDaily(initial.prefix, initial.doc));
    expect(result.sourceOnly).toBe(false);
    expect(result.prefix).toBe(prefix);
    expect(result.doc).toEqual(initial.doc);
  });
  it("keeps nested checklist and list item identities through repeated save cycles", () => {
    const raw =
      prefix +
      "\n" +
      marker("list") +
      '- [ ] <!-- maple:item {"v":1,"id":"task-1"} --> Review the proposal\n  - <!-- maple:item {"v":1,"id":"child"} --> detail\n- [x] <!-- maple:item {"v":1,"id":"task-2"} --> Already done\n';
    const initial = decodeDaily(raw);
    expect(initial.sourceOnly).toBe(false);
    const result = decodeDaily(encodeDaily(initial.prefix, initial.doc));
    expect(result.sourceOnly).toBe(false);
    expect(result.doc).toEqual(initial.doc);
  });
  it("retains an empty block and a draft Maple request without submitting it", () => {
    const raw =
      prefix +
      "\n" +
      marker("empty") +
      "<!-- maple:empty -->\n\n" +
      marker("request", { kind: "maple-request", requestID: "request-1" }) +
      "@maple Find Dominick’s email.\n";
    const parsed = decodeDaily(raw);
    expect(parsed.sourceOnly).toBe(false);
    expect(decodeDaily(encodeDaily(parsed.prefix, parsed.doc)).doc).toEqual(
      parsed.doc,
    );
  });
  it.each([
    "<script>alert(1)</script>",
    '```maple-ref\n{"v":2,"kind":"email","eventID":"id"}\n```',
    marker("same") + "One\n\n" + marker("same") + "Two",
    marker("missing"),
    "<!-- maple:block {broken} -->\nHello",
    "![An unsupported attachment](file:///secret)",
  ])(
    "falls back without attempting to transform unsupported content: %s",
    (body) => {
      expect(decodeDaily(prefix + "\n" + body).sourceOnly).toBe(true);
    },
  );
  it("treats external linked checkbox text as a snapshot, retaining the canonical identity", () => {
    const raw =
      prefix +
      "\n" +
      marker("task", { taskID: "canonical-task" }) +
      "- [x] Changed externally";
    const parsed = decodeDaily(raw);
    expect(parsed.sourceOnly).toBe(false);
    expect(parsed.doc.content?.[0].type).toBe("linkedTask");
    expect(decodeDaily(encodeDaily(parsed.prefix, parsed.doc)).doc).toEqual(
      parsed.doc,
    );
  });
  it("rejects conflicting and ambiguous frontmatter", () => {
    expect(decodeDaily("---\nmaple: mine\n---\nHello").sourceOnly).toBe(true);
    expect(
      decodeDaily(
        "---\nmaple: {format: 1, document: a}\nmaple: {format: 1, document: b}\n---\nHello",
      ).sourceOnly,
    ).toBe(true);
  });
  it("preserves the space between lines of a paragraph", () => {
    const parsed = decodeDaily("one\ntwo");
    expect(parsed.doc.content?.[0].content?.map((n) => n.text).join("")).toBe(
      "one two",
    );
  });
  it('keeps literal identity comments inside fenced examples as code',()=>{const raw='```markdown\n<!-- maple:block {"v":1,"id":"literal"} -->\n- [ ] <!-- maple:item {"v":1,"id":"literal-item"} --> Sample\n```';const value=decodeDaily(raw);expect(value.sourceOnly).toBe(false);expect(value.doc.content?.[0].type).toBe('codeBlock');expect(value.doc.content?.[0].content?.[0].text).toContain('maple:item');expect(decodeDaily(encodeDaily(value.prefix,value.doc)).doc).toEqual(value.doc);});
  it('preserves a linked task command identity without trusting its checkbox snapshot',()=>{const raw=prefix+'\n'+marker('task',{taskID:'task',taskCommandID:'command'})+'- [x] Completed snapshot';const value=decodeDaily(raw);expect(value.sourceOnly).toBe(false);expect(decodeDaily(encodeDaily(value.prefix,value.doc)).doc).toEqual(value.doc);});

});

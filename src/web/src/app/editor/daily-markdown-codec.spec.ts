import { describe, it, expect } from "vitest";
import { decodeDaily, encodeDaily } from "./daily-markdown-codec";
const prefix =
  '---\ntitle: My own title\nmaple:\n  format: 1\n  document: "document-1"\n  day: "2026-09-27"\n---\n';
const marker = (id: string, extra = {}) =>
  "<!-- maple:block " + JSON.stringify({ v: 1, id, ...extra }) + " -->\n";
describe("Daily Markdown codec", () => {
  it("preserves a recording's authorized attachment reference and evidence identity through reopening", () => {
    const reference = { v: 1, kind: "recording", eventID: "immutable-recording", label: "Morning thoughts", attachmentID: "Attachments/" + "a".repeat(64) + ".wav" };
    const raw = prefix + "\n" + marker("recording-block") + "```maple-ref\n" + JSON.stringify(reference) + "\n```\n";
    const decoded = decodeDaily(raw);
    expect(decoded.sourceOnly).toBe(false);
    const reopened = decodeDaily(encodeDaily(decoded.prefix, decoded.doc));
    expect(reopened.doc.content?.[0].attrs?.["reference"]).toEqual(reference);
  });
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
  it("keeps literal identity comments inside fenced examples as code", () => {
    const raw =
      '```markdown\n<!-- maple:block {"v":1,"id":"literal"} -->\n- [ ] <!-- maple:item {"v":1,"id":"literal-item"} --> Sample\n```';
    const value = decodeDaily(raw);
    expect(value.sourceOnly).toBe(false);
    expect(value.doc.content?.[0].type).toBe("codeBlock");
    expect(value.doc.content?.[0].content?.[0].text).toContain("maple:item");
    expect(decodeDaily(encodeDaily(value.prefix, value.doc)).doc).toEqual(
      value.doc,
    );
  });
  it("preserves a linked task command identity without trusting its checkbox snapshot", () => {
    const raw =
      prefix +
      "\n" +
      marker("task", { taskID: "task", taskCommandID: "command" }) +
      "- [x] Completed snapshot";
    const value = decodeDaily(raw);
    expect(value.sourceOnly).toBe(false);
    expect(decodeDaily(encodeDaily(value.prefix, value.doc)).doc).toEqual(
      value.doc,
    );
  });
});

describe("structured Markdown", () => {
  it("roundtrips nested details, all callouts, checklists, a table and underline", () => {
    const raw =
      marker("container") +
      ':::::details {"title":"Project notes","open":true}\n' +
      "::::callout warning\nRead <u>carefully</u> and ~strike this~.\n\n" +
      ':::details {"title":"Inner","open":false}\n- [ ] <!-- maple:item {"v":1,"id":"nested-task"} --> Follow up\n\n| Name | State |\n| --- | --- |\n| A | Ready |\n:::\n::::\n:::::';
    const first = decodeDaily(raw);
    expect(first.sourceOnly).toBe(false);
    expect(first.doc.content?.[0].type).toBe("details");
    expect(decodeDaily(encodeDaily(first.prefix, first.doc)).doc).toEqual(
      first.doc,
    );
    for (const kind of ["info", "warning", "tip", "danger"]) {
      const parsed = decodeDaily(`:::callout ${kind}\nHello\n:::`);
      expect(parsed.sourceOnly).toBe(false);
      expect(parsed.doc.content?.[0].attrs?.["kind"]).toBe(kind);
      expect(decodeDaily(encodeDaily("", parsed.doc)).doc).toEqual(parsed.doc);
    }
  });
  it("does not consume container delimiters or tildes inside code", () => {
    const parsed = decodeDaily(
      ':::details {"title":"Example","open":false}\n```text\n:::\n~literal~\n```\n:::',
    );
    expect(parsed.sourceOnly).toBe(false);
    expect(parsed.doc.content?.[0].content?.[0].content?.[0].text).toBe(
      ":::\n~literal~",
    );
    expect(decodeDaily(encodeDaily("", parsed.doc)).doc).toEqual(parsed.doc);
  });
  it.each([
    ":::callout unknown\nText\n:::",
    ':::details {"title":"X","open":false,"script":true}\nX\n:::',
    ":::callout info\nUnclosed",
    '<u onclick="evil()">Unsafe</u>',
  ])("preserves unsupported structures in source mode: %s", (raw) => {
    expect(decodeDaily(raw).sourceOnly).toBe(true);
  });
  it("preserves ordinary and nested table formatting through repeated saves", () => {
    const first = decodeDaily(
      "| **Name** | ~State~ |\n| --- | --- |\n| A \\| B | `pending` |",
    );
    expect(first.sourceOnly).toBe(false);
    expect(decodeDaily(encodeDaily("", first.doc)).doc).toEqual(first.doc);
  });
});
it("keeps attachment references and interrupted uploads through containers and reopen", () => {
  for (const ref of [null, "Attachments/" + "a".repeat(64) + ".png"]) {
    const raw =
      marker("attachment") +
      "```maple-attachment\n" +
      JSON.stringify({
        v: 1,
        ref,
        name: "A <photo>",
        mimeType: "image/png",
        byteCount: 12,
        kind: "image",
        uploadID: null,
      }) +
      "\n```";
    const parsed = decodeDaily(raw);
    expect(parsed.sourceOnly).toBe(false);
    expect(parsed.doc.content?.[0].type).toBe("attachment");
    expect(decodeDaily(encodeDaily("", parsed.doc)).doc).toEqual(parsed.doc);
    const nested = decodeDaily(
      ":::callout info\n" + raw.slice(raw.indexOf("```")) + "\n:::",
    );
    expect(nested.sourceOnly).toBe(false);
    expect(nested.doc.content?.[0].content?.[0].type).toBe("attachment");
    expect(decodeDaily(encodeDaily("", nested.doc)).doc).toEqual(nested.doc);
  }
});
it("keeps literal marker comments in code nested inside a container", () => {
  const parsed = decodeDaily(
    ':::callout info\n```md\n<!-- maple:item {"v":1,"id":"literal"} -->\n```\n:::',
  );
  expect(parsed.sourceOnly).toBe(false);
  expect(decodeDaily(encodeDaily("", parsed.doc)).doc).toEqual(parsed.doc);
});
it("keeps merged cells, resize widths, and multiple cell paragraphs losslessly", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { maple: { v: 1, id: "rich-table" } },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 2, rowspan: 1, colwidth: [120, 180] },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Merged" }],
                  },
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Second line" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ],
  };
  const encoded = encodeDaily("", doc);
  expect(encoded).toContain("```maple-table");
  const decoded = decodeDaily(encoded);
  expect(decoded.sourceOnly).toBe(false);
  expect(decoded.doc).toEqual(doc);
});
it("keeps a structured section nested in a list item", () => {
  const value = decodeDaily(
    '- Parent\n\n  :::details {"title":"Inner","open":true}\n  Child\n  :::',
  );
  expect(value.sourceOnly).toBe(false);
  expect(value.doc.content?.[0].content?.[0].content?.[1].type).toBe("details");
  expect(decodeDaily(encodeDaily("", value.doc)).doc).toEqual(value.doc);
});

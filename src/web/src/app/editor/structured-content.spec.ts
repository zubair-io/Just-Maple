import { describe, it, expect, vi } from "vitest";
import { CodeBlockWithLanguage } from "../notebooks/sugar-editor/code-block-with-language";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SingleTildeStrike,
  MapleCallout,
  MapleDetails,
} from "./structured-content";
import { markdownBodyToDoc } from "../notebooks/sugar-editor/markdown-to-document";
import {
  sanitizePastedHTML,
  remapPastedIdentities,
} from "../notebooks/sugar-editor/markdown-paste";

describe("safe editor structures", () => {
  it("single tilde parser leaves escapes and code literal and keeps double tilde", () => {
    const nodes =
      markdownBodyToDoc("~yes~ ~~also~~ \\~literal\\~ `~code~`").content?.[0]
        .content ?? [];
    expect(
      nodes
        .filter((n) => n.marks?.some((m) => m.type === "strike"))
        .map((n) => n.text),
    ).toEqual(["yes", "also"]);
    expect(nodes.find((n) => n.text === "~code~")?.marks).toEqual([
      { type: "code" },
    ]);
  });
  it("single tilde typing rule creates strike and callout rule wraps a paragraph", () => {
    const editor = new Editor({
      extensions: [StarterKit, SingleTildeStrike, MapleCallout, MapleDetails],
      content: "<p>~hello~</p>",
    });
    editor.commands.setTextSelection(8);
    // Input rules receive the incoming final character, not text already committed.
    editor.commands.setContent("<p>~hello</p>");
    editor.commands.setTextSelection(7);
    editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, 7, 7, "~", () => editor.state.tr.insertText("~")),
    );
    expect(editor.getJSON().content?.[0].content?.[0].marks).toContainEqual({
      type: "strike",
    });
    editor.commands.setContent("<p>:::tip</p>");
    editor.commands.setTextSelection(7);
    editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, 7, 7, " ", () => editor.state.tr.insertText(" ")),
    );
    expect(editor.getJSON().content?.[0].type).toBe("callout");
    editor.destroy();
  });
  it("sanitizes rich paste without dropping tables or ordinary semantic formatting", () => {
    const html = sanitizePastedHTML(
      '<table style="color:red" onclick="evil()"><tr><td colspan="2"><strong>Hello</strong><a href="javascript:evil()">bad</a></td></tr></table><script>evil()</script><p class="foo"><u>Keep</u></p>',
    );
    expect(html).toContain("<table>");
    expect(html).toContain('colspan="2"');
    expect(html).toContain("<strong>Hello</strong>");
    expect(html).toContain("<u>Keep</u>");
    expect(html).not.toMatch(/style=|onclick|javascript:|script|class=/);
  });
  it("copies block identities without replaying commands or changing task references", () => {
    const source = {
      type: "paragraph",
      attrs: {
        maple: {
          v: 1,
          id: "old",
          kind: "maple-request",
          requestID: "request",
          runID: "run",
          taskCommandID: "command",
          taskID: "task",
        },
      },
    };
    const [copy] = remapPastedIdentities([source]);
    expect(copy.attrs?.["maple"]).toMatchObject({ v: 1, taskID: "task" });
    expect(copy.attrs?.["maple"]).not.toHaveProperty("requestID");
    expect((copy.attrs?.["maple"] as { id: string }).id).not.toBe("old");
    expect(source.attrs.maple.id).toBe("old");
  });
});

it("copies the current code and targets its own language selector", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockWithLanguage,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "custom title" },
          content: [{ type: "text", text: "latest code" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "outside" }] },
      ],
    },
  });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  const select = element.querySelector("select")!;
  select.value = "python";
  select.dispatchEvent(new Event("change"));
  expect(editor.getJSON().content?.[0].attrs?.["language"]).toBe("python");
  expect(editor.getJSON().content?.[1].type).toBe("paragraph");
  element.querySelector<HTMLButtonElement>(".code-block-copy")!.click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledWith("latest code");
  editor.destroy();
  element.remove();
});
it("expands details while readonly without changing saved state", () => {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    editable: false,
    extensions: [StarterKit, MapleDetails],
    content: {
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { title: "Read me", open: false },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Nested content" }],
            },
          ],
        },
      ],
    },
  });
  const content = element.querySelector<HTMLElement>(".maple-details-content")!;
  expect(content.hidden).toBe(true);
  element
    .querySelector<HTMLButtonElement>(".maple-details-header button")!
    .click();
  expect(content.hidden).toBe(false);
  expect(editor.getJSON().content?.[0].attrs?.["open"]).toBe(false);
  editor.destroy();
  element.remove();
});

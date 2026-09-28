import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { markdownBodyToDoc, ProseMirrorNode } from "./markdown-to-document";
import { createMarkdownParser } from "./markdown-parser";

export function isMarkdownContent(text: string): boolean {
  return /<!-- maple:block |(^|\n)(?:#{1,6} |\s*[-*+] |\s*\d+\. |>|`{3}|~{3}|:{3}(?:callout|details)|\|)|\*\*[^*]+\*\*|\*[^*\n]+\*|~[^~\n]+~|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(
    text,
  );
}

/** External rich text brings structure, never styles, handlers or active URLs. */
export function sanitizePastedHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll(
      "script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,svg,math",
    )
    .forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const structural = [
        "colspan",
        "rowspan",
        "start",
        "open",
        "data-type",
        "data-checked",
        "data-kind",
        "data-maple-callout",
        "data-maple-details",
        "data-details-content",
        "data-language",
        "data-maple-reference",
        "data-task-id",
        "data-label",
        "data-markdown",
      ];
      if (name === "href") {
        if (!/^(https?:|mailto:|tel:|#)/i.test(attr.value.trim()))
          el.removeAttribute(attr.name);
      } else if (!structural.includes(name)) el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll("details").forEach((details) => {
    if (details.querySelector(":scope > [data-details-content]")) return;
    const content = doc.createElement("div");
    content.setAttribute("data-details-content", "");
    Array.from(details.childNodes)
      .filter(
        (node) => !(node instanceof Element && node.tagName === "SUMMARY"),
      )
      .forEach((node) => content.append(node));
    details.append(content);
  });
  return doc.body.innerHTML;
}
export async function markdownToHtml(markdown: string): Promise<string> {
  return sanitizePastedHTML(createMarkdownParser().render(markdown));
}

/** Clipboard copies are new blocks, never replays of an agent request or task command. */
export function remapPastedIdentities(
  nodes: ProseMirrorNode[],
): ProseMirrorNode[] {
  return nodes.map((node) => {
    const attrs = { ...node.attrs };
    const meta = attrs["maple"] as Record<string, unknown> | undefined;
    if (meta)
      attrs["maple"] = {
        v: 1,
        id: crypto.randomUUID(),
        ...(meta["taskID"] ? { taskID: meta["taskID"] } : {}),
      };
    return {
      ...node,
      ...(node.attrs ? { attrs } : {}),
      ...(node.content ? { content: remapPastedIdentities(node.content) } : {}),
    };
  });
}
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addOptions() {
    return {
      parseMarkdown: (text: string) => markdownBodyToDoc(text).content ?? [],
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const parse = this.options.parseMarkdown;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          transformPastedHTML: sanitizePastedHTML,
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || view.state.selection.$from.parent.type.spec.code)
              return false;
            const html = data.getData("text/html");
            if (html.trim()) return false; // sanitized above; schema and identity plugin process the slice.
            const text = data.getData("text/plain");
            if (!text.trim() || !isMarkdownContent(text)) return false;
            event.preventDefault();
            try {
              // Reserved metadata in plain text is not authority. Keep the visible text and
              // strip only actual comment markers outside code via the parsed node tree.
              const parsed = remapPastedIdentities(parse(text));
              editor.commands.insertContent(parsed);
            } catch {
              view.dispatch(view.state.tr.insertText(text));
            }
            return true;
          },
        },
      }),
    ];
  },
});

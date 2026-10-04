import { readCanvas } from "../canvas/canvas-layout";
import { createMarkdownParser } from "../notebooks/sugar-editor/markdown-parser";
import { parseDocument } from "yaml";
import {
  markdownBodyToDoc,
  ProseMirrorNode,
} from "../notebooks/sugar-editor/markdown-to-document";
import {
  docToMarkdown,
  structuredMarkdown,
} from "../notebooks/sugar-editor/document-to-markdown";
import { splitMarkdown } from "../notebooks/markdown-format";
export interface BlockMetadata {
  v: 1;
  id: string;
  kind?: "maple-request" | "maple-reply";
  requestID?: string;
  runID?: string;
  taskID?: string;
  taskCommandID?: string;
  contextBlockIDs?: string[];
}
export interface SourceReference {
  v: 1;
  kind: string;
  eventID: string;
  label?: string;
  attachmentID?: string;
}
export interface DecodedDaily {
  prefix: string;
  doc: ProseMirrorNode;
  sourceOnly: boolean;
  reason: string;
}
const parser = createMarkdownParser();
const kinds = new Set([
  "email",
  "message",
  "imessage",
  "home",
  "ha",
  "event",
  "calendar",
  "recording",
  "source",
]);
function failure(prefix: string, reason: string): DecodedDaily {
  return {
    prefix,
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    sourceOnly: true,
    reason,
  };
}
function metadata(raw: string): BlockMetadata {
  const data = JSON.parse(raw);
  if (
    data.v !== 1 ||
    typeof data.id !== "string" ||
    !data.id ||
    data.id.length > 128
  )
    throw Error("Unsupported block identity");
  if (
    Object.keys(data).some(
      (key) =>
        ![
          "v",
          "id",
          "kind",
          "requestID",
          "runID",
          "taskID",
          "taskCommandID",
          "contextBlockIDs",
        ].includes(key),
    )
  )
    throw Error("Unknown block metadata");
  if (data.kind && !["maple-request", "maple-reply"].includes(data.kind))
    throw Error("Unknown block kind");
  if (data.contextBlockIDs !== undefined && (!Array.isArray(data.contextBlockIDs) || data.contextBlockIDs.length > 32 || data.contextBlockIDs.some((id: unknown) => typeof id !== "string" || !id || id.length > 128) || new Set(data.contextBlockIDs).size !== data.contextBlockIDs.length)) throw Error("Invalid Maple context selection");
  if (data.taskID && typeof data.taskID !== "string")
    throw Error("Invalid linked task identity");
  return data;
}
function safeJSON(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/-/g, "\\u002d");
}
export function decodeDaily(raw: string): DecodedDaily {
  const { prefix, body } = splitMarkdown(raw);
  if (new TextEncoder().encode(raw).length > 256000)
    return failure(
      prefix,
      "This file exceeds the 256 KB editor limit. Its complete text is preserved.",
    );
  if (raw.startsWith("---\n") && !prefix)
    return failure(
      prefix,
      "Unclosed frontmatter is preserved in Markdown mode.",
    );
  if (prefix) {
    const yaml = parseDocument(
      prefix
        .replace(/^(?:\uFEFF)?---\r?\n/, "")
        .replace(/(?:---|\.\.\.)\r?\n$/, ""),
    );
    if (yaml.errors.length)
      return failure(
        prefix,
        "Ambiguous frontmatter is preserved in Markdown mode.",
      );
    const data = yaml.toJS();
    if (
      data?.maple &&
      (data.maple.format !== 1 || typeof data.maple.document !== "string")
    )
      return failure(prefix, "This document uses an unsupported Maple format.");
  }
  try { readCanvas(prefix); } catch (error) { return failure(prefix, error instanceof Error ? error.message : "Unsupported canvas layout"); }
  const nodes: ProseMirrorNode[] = [];
  const seen = new Set<string>();
  let pending: BlockMetadata | undefined;
  try {
    const lines = body.split("\n");
    const tokens = parser.parse(body, {});
    for (const token of tokens) {
      if (token.level !== 0 || !token.map || token.nesting === -1) continue;
      const segment = lines
        .slice(token.map[0], token.map[1])
        .join("\n")
        .trimEnd();
      if (token.type === "html_block" && segment === "<!-- maple:empty -->") {
        const identity = pending ?? { v: 1 as const, id: crypto.randomUUID() };
        if (seen.has(identity.id))
          throw Error("Duplicate block identities require reconciliation");
        seen.add(identity.id);
        nodes.push({ type: "paragraph", attrs: { maple: identity } });
        pending = undefined;
        continue;
      }
      if (token.type === "html_block") {
        const match = segment.match(/^<!-- maple:block (\{[^\n]*\}) -->$/);
        if (!match || pending)
          throw Error("Unsupported HTML or incomplete identity marker");
        pending = metadata(match[1]);
        continue;
      }
      let parsed: ProseMirrorNode[];
      if (pending?.taskID) {
        if (!/^- \[[ xX]\] [^\n]+$/.test(segment))
          throw Error(
            "Complex linked task Markdown is preserved in source mode",
          );
        parsed = [
          {
            type: "linkedTask",
            attrs: {
              taskID: pending.taskID,
              markdown: segment,
              label: segment.replace(/^- \[[ xX]\] /, ""),
            },
          },
        ];
      } else if (token.type === "fence" && token.info === "maple-attachment") {
        parsed = [parseAttachment(token.content)];
      } else if (token.type === "fence" && token.info === "maple-ref") {
        const ref = JSON.parse(token.content) as SourceReference;
        if (
          ref.v !== 1 ||
          !kinds.has(ref.kind) ||
          typeof ref.eventID !== "string" ||
          !ref.eventID ||
          Object.keys(ref).some(
            (key) =>
              !["v", "kind", "eventID", "label", "attachmentID"].includes(key),
          )
        )
          throw Error("Unsupported source reference");
        parsed = [{ type: "sourceReference", attrs: { reference: ref } }];
      } else {
        const items: BlockMetadata[] = [];
        const code = ["fence", "code_block"].includes(token.type);
        const stripped = code
          ? segment
          : outsideCode(segment, (text) =>
              text.replace(
                /<!-- maple:item (\{[^\n]*?\}) -->\s?/g,
                (_, json) => {
                  items.push(metadata(json));
                  return "";
                },
              ),
            );
        // These constructs cannot be faithfully represented by our current extension set.
        if (
          !code &&
          /<\/?[a-z!]|!\[|\[\[|```maple:|\{(?:id|priority|due|color)[:=]|^\[\^[^\]]+\]:|^\$\$/im.test(
            outsideCode(stripped, (text) => text.replace(/<\/?u>/g, ""), true),
          )
        )
          throw Error("Extended Markdown is preserved in source mode");
        if (
          token.type === "fence" &&
          token.info.startsWith("maple") &&
          token.info !== "maple-table"
        )
          throw Error("Unknown Maple extension");
        parsed = markdownBodyToDoc(stripped).content ?? [];
        let itemIndex = 0;
        const visit = (node: ProseMirrorNode) => {
          if (
            node.type === "codeBlock" &&
            node.attrs?.["language"] === "maple-attachment"
          ) {
            const attachment = parseAttachment(
              node.content?.map((n) => n.text ?? "").join("") ?? "",
            );
            node.type = attachment.type;
            node.attrs = attachment.attrs;
            delete node.content;
          }
          if (["listItem", "taskItem"].includes(node.type)) {
            const identity = items[itemIndex++] ??
              (node.attrs?.["maple"]
                ? metadata(JSON.stringify(node.attrs["maple"]))
                : undefined) ?? {
                v: 1,
                id: crypto.randomUUID(),
              };
            if (seen.has(identity.id))
              throw Error("Duplicate block identities require reconciliation");
            seen.add(identity.id);
            node.attrs = { ...node.attrs, maple: identity };
          }
          node.content?.forEach(visit);
        };
        parsed.forEach(visit);
        if (items.length > itemIndex)
          throw Error("List identity markers could not be reconciled");
      }
      for (const [index, node] of parsed.entries()) {
        const identity =
          index === 0 && pending
            ? pending
            : { v: 1 as const, id: crypto.randomUUID() };
        if (seen.has(identity.id))
          throw Error("Duplicate block identities require reconciliation");
        seen.add(identity.id);
        node.attrs = { ...node.attrs, maple: identity };
        nodes.push(node);
      }
      pending = undefined;
    }
    if (pending) throw Error("A block identity marker is missing its content");
    return {
      prefix,
      doc: {
        type: "doc",
        content: nodes.length
          ? nodes
          : [
              {
                type: "paragraph",
                attrs: { maple: { v: 1, id: crypto.randomUUID() } },
              },
            ],
      },
      sourceOnly: false,
      reason: "",
    };
  } catch (e) {
    return failure(
      prefix,
      e instanceof Error
        ? e.message
        : "This Markdown format is preserved in source mode.",
    );
  }
}
function listMarkdown(node: ProseMirrorNode, depth = 0): string {
  return (node.content ?? [])
    .map((item, index) => {
      const meta = item.attrs?.["maple"] as BlockMetadata | undefined;
      const marker = meta ? `<!-- maple:item ${safeJSON(meta)} --> ` : "";
      const bullet =
        node.type === "taskList"
          ? `- [${item.attrs?.["checked"] ? "x" : " "}] `
          : node.type === "orderedList"
            ? `${Number(node.attrs?.["start"] ?? 1) + index}. `
            : "- ";
      const children = item.content ?? [];
      return (
        bullet +
        marker +
        children
          .map((child, i) => {
            const nestedList = [
              "bulletList",
              "orderedList",
              "taskList",
            ].includes(child.type);
            const body = nestedList
              ? listMarkdown(child, depth + 1)
              : child.type === "attachment"
                ? attachmentMarkdown(child)
                : ["callout", "details"].includes(child.type)
                  ? structuredMarkdown(child, structuredBody(child))
                  : docToMarkdown({ type: "doc", content: [child] });
            const indent = " ".repeat(
              node.type === "orderedList" ? bullet.length : 2,
            );
            const lines = body.split("\n");
            return (
              (i ? (nestedList ? "\n" : "\n\n") : "") +
              lines
                .map((line, index) => (i || index ? indent : "") + line)
                .join("\n")
            );
          })
          .join("")
      );
    })
    .join("\n");
}
export function encodeDaily(prefix: string, doc: ProseMirrorNode): string {
  return (
    prefix +
    (prefix && !prefix.endsWith("\n\n") ? "\n" : "") +
    (doc.content ?? [])
      .map((node) => {
        const meta = node.attrs?.["maple"] as BlockMetadata | undefined;
        const header = meta ? `<!-- maple:block ${safeJSON(meta)} -->\n` : "";
        let body: string;
        if (node.type === "linkedTask")
          body = String(node.attrs?.["markdown"] ?? "");
        else if (node.type === "attachment") body = attachmentMarkdown(node);
        else if (node.type === "sourceReference")
          body =
            "```maple-ref\n" +
            JSON.stringify(node.attrs?.["reference"]) +
            "\n```";
        else if (["bulletList", "orderedList", "taskList"].includes(node.type))
          body = listMarkdown(node);
        else if (["callout", "details"].includes(node.type))
          body = structuredMarkdown(node, structuredBody(node));
        else body = docToMarkdown({ type: "doc", content: [node] });
        return header + (body || "<!-- maple:empty -->");
      })
      .join("\n\n") +
    "\n"
  );
}

function structuredBody(node: ProseMirrorNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === "attachment") return attachmentMarkdown(child);
      if (["callout", "details"].includes(child.type))
        return structuredMarkdown(child, structuredBody(child));
      if (["bulletList", "orderedList", "taskList"].includes(child.type))
        return listMarkdown(child);
      return docToMarkdown({ type: "doc", content: [child] });
    })
    .join("\n\n");
}

function attachmentMarkdown(node: ProseMirrorNode): string {
  const attrs = node.attrs ?? {};
  return (
    "```maple-attachment\n" +
    JSON.stringify({
      v: 1,
      ref: attrs["ref"] ?? null,
      name: attrs["name"] ?? "",
      mimeType: attrs["mimeType"] ?? "",
      byteCount: attrs["byteCount"] ?? 0,
      kind: attrs["kind"] ?? "file",
      uploadID: attrs["uploadID"] ?? null,
    }) +
    "\n```"
  );
}

function parseAttachment(raw: string): ProseMirrorNode {
  const attachment = JSON.parse(raw);
  if (
    attachment.v !== 1 ||
    !["image", "file"].includes(attachment.kind) ||
    typeof attachment.name !== "string" ||
    typeof attachment.mimeType !== "string" ||
    !Number.isSafeInteger(attachment.byteCount) ||
    attachment.byteCount < 0 ||
    (attachment.uploadID != null && typeof attachment.uploadID !== "string") ||
    (attachment.ref != null &&
      !/^Attachments\/[0-9a-f]{64}\.(png|jpg|gif|webp|pdf|txt|m4a|mp3|wav|bin)$/.test(
        attachment.ref,
      )) ||
    Object.keys(attachment).some(
      (key) =>
        ![
          "v",
          "ref",
          "name",
          "mimeType",
          "byteCount",
          "kind",
          "uploadID",
        ].includes(key),
    )
  )
    throw Error("Unsupported attachment reference");
  return {
    type: "attachment",
    attrs: {
      ref: attachment.ref ?? null,
      name: attachment.name,
      mimeType: attachment.mimeType,
      byteCount: attachment.byteCount,
      kind: attachment.kind,
      uploadID: attachment.uploadID ?? null,
    },
  };
}

function outsideCode(
  value: string,
  transform: (text: string) => string,
  maskCode = false,
): string {
  let fence = "";
  return value
    .split("\n")
    .map((line) => {
      const match = /^\s*(`{3,}|~{3,})/.exec(line);
      if (match) {
        if (!fence) {
          fence = match[1];
          return maskCode ? "" : line;
        }
        if (
          match[1][0] === fence[0] &&
          match[1].length >= fence.length &&
          line.trim() === match[1]
        ) {
          fence = "";
          return maskCode ? "" : line;
        }
      }
      return fence ? (maskCode ? "" : line) : transform(line);
    })
    .join("\n");
}

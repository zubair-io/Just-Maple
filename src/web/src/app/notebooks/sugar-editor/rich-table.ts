import type { ProseMirrorNode } from "./markdown-to-document";

export function needsRichTable(node: ProseMirrorNode): boolean {
  const rows = node.content ?? [];
  const width = rows[0]?.content?.length ?? 0;
  return (
    rows.some(
      (row, index) =>
        row.content?.length !== width ||
        row.content?.some(
          (cell) =>
            cell.type !== (index === 0 ? "tableHeader" : "tableCell") ||
            Number(cell.attrs?.["colspan"] ?? 1) !== 1 ||
            Number(cell.attrs?.["rowspan"] ?? 1) !== 1 ||
            cell.attrs?.["colwidth"] != null ||
            cell.content?.length !== 1 ||
            cell.content[0].type !== "paragraph" ||
            cell.content[0].content?.some((n) => n.type !== "text"),
        ),
    ) || false
  );
}
export function richTableMarkdown(node: ProseMirrorNode): string {
  const copy = structuredClone(node);
  if (copy.attrs) delete copy.attrs["maple"];
  return "```maple-table\n" + JSON.stringify({ v: 1, table: copy }) + "\n```";
}
export function parseRichTable(raw: string): ProseMirrorNode {
  const value = JSON.parse(raw);
  if (
    value.v !== 1 ||
    value.table?.type !== "table" ||
    Object.keys(value).some((k) => !["v", "table"].includes(k))
  )
    throw Error("Unsupported table format");
  let count = 0;
  const allowed = new Set([
    "table",
    "tableRow",
    "tableHeader",
    "tableCell",
    "paragraph",
    "heading",
    "text",
    "hardBreak",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
    "blockquote",
    "codeBlock",
    "horizontalRule",
  ]);
  const attrs = new Set([
    "colspan",
    "rowspan",
    "colwidth",
    "start",
    "level",
    "checked",
    "language",
    "maple",
  ]);
  const marks = new Set([
    "bold",
    "italic",
    "strike",
    "underline",
    "code",
    "link",
  ]);
  const visit = (node: ProseMirrorNode, depth: number) => {
    if (
      ++count > 10000 ||
      depth > 30 ||
      !allowed.has(node.type) ||
      Object.keys(node).some(
        (k) => !["type", "attrs", "content", "text", "marks"].includes(k),
      )
    )
      throw Error("Unsupported table content");
    if (node.attrs && Object.keys(node.attrs).some((k) => !attrs.has(k)))
      throw Error("Unsupported table attributes");
    if (
      node.type === "table" &&
      node.content?.some((n) => n.type !== "tableRow")
    )
      throw Error("Invalid table rows");
    if (
      node.type === "tableRow" &&
      node.content?.some((n) => !["tableCell", "tableHeader"].includes(n.type))
    )
      throw Error("Invalid table cells");
    for (const mark of node.marks ?? []) {
      if (
        !marks.has(mark.type) ||
        (mark.type === "link" &&
          !/^(https?:|mailto:|tel:|#)/i.test(
            String(mark.attrs?.["href"] ?? ""),
          ))
      )
        throw Error("Unsupported table formatting");
    }
    for (const child of node.content ?? []) visit(child, depth + 1);
  };
  visit(value.table, 0);
  return value.table;
}

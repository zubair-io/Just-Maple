import type { JSONContent } from "@tiptap/core";

/**
 * Upgrade legacy top-level details into ordinary heading sections. This is a
 * presentation migration: callers must not save just because it changed JSON.
 * Containers such as lists and callouts retain their nested legacy structures.
 * Heading sections end at the next heading of equal or lesser depth, so trailing
 * prose without a heading cannot retain the old details' exact folding boundary.
 */
export function normalizeLegacySections(doc: JSONContent): JSONContent {
  const result = structuredClone(doc);
  if (result.type !== "doc" || !result.content) return result;
  const reserved = new Set<string>();
  const collect = (node: JSONContent) => {
    const id = node.attrs?.["maple"]?.id;
    if (typeof id === "string") reserved.add(id);
    node.content?.forEach(collect);
  };
  collect(result);
  const identify = (node: JSONContent): JSONContent => {
    if (node.attrs?.["maple"]?.id) return node;
    let id: string;
    do id = crypto.randomUUID();
    while (reserved.has(id));
    reserved.add(id);
    node.attrs = {
      ...node.attrs,
      maple: { ...node.attrs?.["maple"], v: 1, id },
    };
    return node;
  };
  const level = (node: JSONContent) => {
    const value = Number(node.attrs?.["level"] ?? 1);
    return Number.isFinite(value) ? Math.max(1, Math.min(6, value)) : 1;
  };
  const flatten = (
    nodes: JSONContent[],
    minimum: number,
    previous: number,
    exposed: boolean,
  ): JSONContent[] => {
    // Shift the body's existing headings together, preserving relative depth
    // wherever the six standard Markdown heading levels allow it.
    const headings = nodes.filter((node) => node.type === "heading");
    const offset = headings.length
      ? Math.max(0, minimum - Math.min(...headings.map(level)))
      : 0;
    const output: JSONContent[] = [];
    nodes.forEach((node, index) => {
      if (node.type === "details") {
        const nextHeading = nodes
          .slice(index + 1)
          .find((candidate) => candidate.type === "heading");
        // A following pre-existing section must not become a child of this
        // newly exposed heading, even if the old outline skipped levels.
        const depth = Math.min(
          6,
          Math.max(
            minimum,
            previous ? previous + 1 : 2,
            nextHeading ? level(nextHeading) + offset : 1,
          ),
        );
        const title = node.attrs?.["title"];
        const heading = identify({
          type: "heading",
          attrs: {
            level: depth,
            ...(node.attrs?.["maple"] ? { maple: node.attrs["maple"] } : {}),
          },
          content:
            typeof title === "string" && title.length
              ? [{ type: "text", text: title }]
              : [],
        });
        output.push(
          heading,
          ...flatten(node.content ?? [], Math.min(6, depth + 1), depth, true),
        );
        // Sibling details stay siblings; their former container does not alter
        // the surrounding original outline's active heading.
      } else {
        if (node.type === "heading") {
          previous = Math.min(6, level(node) + offset);
          node.attrs = { ...node.attrs, level: previous };
        }
        output.push(exposed ? identify(node) : node);
      }
    });
    return output;
  };
  result.content = flatten(result.content, 1, 0, false);
  return result;
}

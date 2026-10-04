import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { normalizeLegacySections } from "./legacy-sections";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const heading = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

describe("legacy section migration", () => {
  it("preserves identities, source evidence, tasks and marks without mutating input", () => {
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "details",
          attrs: {
            title: "Follow ups",
            open: false,
            maple: { v: 1, id: "section" },
          },
          content: [
            {
              type: "sourceReference",
              attrs: {
                maple: { v: 1, id: "email" },
                reference: { v: 1, kind: "email", eventID: "e1" },
              },
            },
            {
              type: "linkedTask",
              attrs: {
                taskID: "t1",
                maple: { v: 1, id: "task", taskID: "t1" },
              },
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Keep this", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
      ],
    };
    const original = structuredClone(source);
    const migrated = normalizeLegacySections(source);
    expect(source).toEqual(original);
    expect(migrated.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2, maple: { id: "section" } },
    });
    expect(migrated.content?.[1]).toEqual(source.content?.[0].content?.[0]);
    expect(migrated.content?.[2]).toEqual(source.content?.[0].content?.[1]);
    expect(migrated.content?.[3].content).toEqual(
      source.content?.[0].content?.[2].content,
    );
    const ids = migrated.content!.map((node) => node.attrs?.["maple"].id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(normalizeLegacySections(migrated)).toEqual(migrated);
  });

  it("exposes direct nested details and preserves sibling and surrounding headings", () => {
    const migrated = normalizeLegacySections({
      type: "doc",
      content: [
        heading(1, "Day"),
        {
          type: "details",
          attrs: { title: "Section" },
          content: [
            paragraph("Body"),
            {
              type: "details",
              attrs: { title: "Child" },
              content: [paragraph("Nested")],
            },
            {
              type: "details",
              attrs: { title: "Sibling" },
              content: [paragraph("Other")],
            },
          ],
        },
        heading(2, "Next"),
      ],
    });
    expect(migrated.content?.map((node) => node.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
    ]);
    expect(
      migrated.content
        ?.filter((node) => node.type === "heading")
        .map((node) => node.attrs?.["level"]),
    ).toEqual([1, 2, 3, 3, 2]);
  });

  it("rebases headings inside details and does not absorb a following deep heading", () => {
    const migrated = normalizeLegacySections({
      type: "doc",
      content: [
        heading(1, "Day"),
        {
          type: "details",
          attrs: { title: "Legacy" },
          content: [heading(1, "Inner"), heading(2, "Nested")],
        },
        heading(3, "Original section"),
      ],
    });
    expect(migrated.content?.map((node) => node.attrs?.["level"])).toEqual([
      1, 3, 4, 5, 3,
    ]);
  });

  it("retains nested legacy details within semantic containers", () => {
    const nested: JSONContent = {
      type: "details",
      attrs: { title: "Keep scope" },
      content: [paragraph("Body")],
    };
    const containers: JSONContent[] = [
      { type: "callout", attrs: { kind: "warning" }, content: [nested] },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph("List"), nested] }],
      },
    ];
    const migrated = normalizeLegacySections({
      type: "doc",
      content: [
        { type: "details", attrs: { title: "Parent" }, content: containers },
      ],
    });
    expect(migrated.content?.[1].content).toEqual(containers[0].content);
    expect(migrated.content?.[2].content).toEqual(containers[1].content);
    expect(migrated.content?.[1].attrs?.["maple"].id).not.toBe(
      migrated.content?.[2].attrs?.["maple"].id,
    );
  });

  it("clamps deeply nested sections at H6 and preserves empty titles", () => {
    let node: JSONContent = {
      type: "details",
      attrs: { title: "" },
      content: [paragraph("End")],
    };
    for (let index = 0; index < 8; index++)
      node = {
        type: "details",
        attrs: { title: `Depth ${index}` },
        content: [node],
      };
    const migrated = normalizeLegacySections({ type: "doc", content: [node] });
    expect(migrated.content).toHaveLength(10);
    expect(
      migrated.content
        ?.slice(0, 9)
        .every((item) => item.type === "heading" && item.attrs?.["level"] <= 6),
    ).toBe(true);
    expect(migrated.content?.[8].content).toEqual([]);
  });

  it("leaves documents without legacy details semantically unchanged", () => {
    const source = {
      type: "doc",
      content: [heading(2, "Title"), paragraph("Text")],
    };
    expect(normalizeLegacySections(source)).toEqual(source);
    expect(normalizeLegacySections(source)).not.toBe(source);
  });
});

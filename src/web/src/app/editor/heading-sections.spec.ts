import { TestBed, ComponentFixture } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleEditorComponent } from "./maple-editor.component";
import {
  headingSections,
  headingSectionsKey,
  toggleHeadingSection,
} from "./heading-sections";
import { decodeDaily } from "./daily-markdown-codec";
let fixture: ComponentFixture<MapleEditorComponent>;
function mount(
  markdown = "# Plan\n\nOpening\n\n## Research\n\nEvidence\n\n### Sources\n\nKeep these\n\n## Next\n\nFollow up\n\n# Tomorrow\n\nKeep visible",
) {
  fixture = TestBed.createComponent(MapleEditorComponent);
  fixture.componentRef.setInput("initial", markdown);
  fixture.detectChanges();
  return fixture.componentInstance;
}
afterEach(() => {
  fixture?.destroy();
  TestBed.resetTestingModule();
});
describe("Heading stations", () => {
  it("folds the Markdown outline including nested sections without editing or hiding the next peer", () => {
    const component = mount(),
      editor = component.editor!,
      changed = vi.fn();
    component.changed.subscribe(changed);
    const sections = headingSections(editor.state.doc),
      before = editor.getJSON();
    expect(sections.map((s) => [s.title, s.blocks])).toEqual([
      ["Plan", 7],
      ["Research", 3],
      ["Sources", 1],
      ["Next", 1],
      ["Tomorrow", 1],
    ]);
    toggleHeadingSection(editor.view, sections[1].id);
    const hidden = editor.view.dom.querySelectorAll(".maple-section-hidden");
    expect(hidden).toHaveLength(3);
    expect(
      Array.from(hidden)
        .map((n) => n.textContent)
        .join("|"),
    ).toContain("Evidence");
    expect(
      Array.from(hidden)
        .map((n) => n.textContent)
        .join("|"),
    ).not.toContain("Follow up");
    expect(editor.getJSON()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    const button = editor.view.dom.querySelector(
      '[aria-label="Expand section: Research"]',
    );
    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });
  it("retains inner folds when a parent closes and opens", () => {
    const editor = mount().editor!,
      sections = headingSections(editor.state.doc);
    toggleHeadingSection(editor.view, sections[2].id);
    toggleHeadingSection(editor.view, sections[1].id);
    toggleHeadingSection(editor.view, sections[1].id);
    expect(
      editor.view.dom.querySelectorAll(".maple-section-hidden"),
    ).toHaveLength(1);
    expect(
      editor.view.dom.querySelector('[aria-label="Expand section: Sources"]'),
    ).not.toBeNull();
  });
  it("moves a hidden selection onto its heading and reveals a section before keyboard editing inside it", () => {
    const editor = mount().editor!,
      section = headingSections(editor.state.doc)[1];
    editor.commands.setTextSelection(section.body + 2);
    toggleHeadingSection(editor.view, section.id);
    expect(editor.state.selection.from).toBe(section.body - 1);
    editor.commands.setTextSelection(section.body + 2);
    expect(headingSectionsKey.getState(editor.state)?.folded.size).toBe(0);
    editor.commands.insertContent("edited");
    expect(
      editor.view.dom.querySelectorAll(".maple-section-hidden"),
    ).toHaveLength(0);
  });
  it("supports keyboard station focus and read-only folding without changing document history", async () => {
    const component = mount(),
      editor = component.editor!;
    fixture.componentRef.setInput("readOnly", true);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = editor.view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse section: Research"]',
    )!;
    button.focus();
    button.click();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Expand section: Research",
    );
    expect(editor.can().undo()).toBe(false);
    expect(editor.isEditable).toBe(false);
  });
  it("converts legacy details to heading stations and only persists migration with an edit", () => {
    const original =
      '<!-- maple:block {"v":1,"id":"keep"} -->\n:::details {"title":"Reference","open":false}\nOld content\n:::\n';
    const component = mount(original),
      editor = component.editor!;
    expect(component.raw).toBe(original);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "heading",
      attrs: { maple: { id: "keep" } },
    });
    expect(editor.view.dom.querySelector(".maple-details")).toBeNull();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" updated");
    const reopened = decodeDaily(component.raw);
    expect(reopened.sourceOnly).toBe(false);
    expect(reopened.doc.content?.[0].attrs?.["maple"]).toMatchObject({
      id: "keep",
    });
    expect(component.raw).not.toContain(":::details");
    expect(component.raw).toContain("Old content updated");
  });
});

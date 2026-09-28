import { TestBed, ComponentFixture } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleEditorComponent } from "./maple-editor.component";
import { decodeDaily } from "./daily-markdown-codec";
let fixture: ComponentFixture<MapleEditorComponent> | undefined;
function mount(
  raw = '<!-- maple:block {"v":1,"id":"original"} -->\nKeep this writing.\n',
) {
  fixture = TestBed.createComponent(MapleEditorComponent);
  fixture.componentRef.setInput("initial", raw);
  fixture.detectChanges();
  return fixture.componentInstance;
}
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  TestBed.resetTestingModule();
});
describe("Daily editor floating toolbar", () => {
  it("reports formatted and Markdown editing presence and releases it on destruction", () => {
    const component = mount(),
      presence = vi.fn();
    component.editingChanged.subscribe(presence);
    component.editor!.view.dom.dispatchEvent(new FocusEvent("focus"));
    expect(presence).toHaveBeenLastCalledWith(true);
    component.editor!.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(presence).toHaveBeenLastCalledWith(false);
    component.toggleSource();
    fixture!.detectChanges();
    const textarea = fixture!.nativeElement.querySelector("textarea");
    textarea.dispatchEvent(new FocusEvent("focus"));
    expect(presence).toHaveBeenLastCalledWith(true);
    fixture!.destroy();
    fixture = undefined;
    expect(presence).toHaveBeenLastCalledWith(false);
  });
  it("opens document tools from the toolbar and retains access in read-only mode", () => {
    const component = mount();
    fixture!.componentRef.setInput("documentToolsAvailable", true);
    fixture!.detectChanges();
    const requested = vi.fn();
    component.documentToolsRequested.subscribe(requested);
    fixture!.nativeElement
      .querySelector('[aria-label="Document tools"]')
      .click();
    expect(requested).toHaveBeenCalledOnce();
    fixture!.componentRef.setInput("readOnly", true);
    fixture!.detectChanges();
    const button = Array.from(
      fixture!.nativeElement.querySelectorAll(
        "button",
      ) as NodeListOf<HTMLButtonElement>,
    ).find((element) => element.textContent?.trim() === "Document tools")!;
    expect(button).toBeTruthy();
    button.click();
    expect(requested).toHaveBeenCalledTimes(2);
  });
  it("formats the current selection and preserves Markdown identity across reopening", () => {
    const component = mount();
    component.editor!.commands.setTextSelection({ from: 1, to: 5 });
    component.format("bold");
    component.format("underline");
    const reopened = decodeDaily(component.raw);
    expect(reopened.sourceOnly).toBe(false);
    expect(reopened.doc.content?.[0].attrs?.["maple"]).toEqual({
      v: 1,
      id: "original",
    });
    const marks = (reopened.doc.content?.[0].content?.[0] as any).marks;
    expect(marks.map((m: any) => m.type)).toEqual(
      expect.arrayContaining(["bold", "underline"]),
    );
    fixture!.detectChanges();
    expect(
      fixture!.nativeElement
        .querySelector('[aria-label="Bold · ⌘B"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("keeps the original block identity when converting a paragraph into a checklist", () => {
    const component = mount();
    component.editor!.commands.setTextSelection(1);
    component.insert("task");
    const reopened = decodeDaily(component.raw);
    expect(reopened.sourceOnly).toBe(false);
    expect(reopened.doc.content?.[0].type).toBe("taskList");
    expect(reopened.doc.content?.[0].attrs?.["maple"]).toEqual({
      v: 1,
      id: "original",
    });
    expect(
      reopened.doc.content?.[0].content?.[0].attrs?.["maple"],
    ).toHaveProperty("id");
  });
  it("uses table commands at the selected cell and persists the changed grid", () => {
    const component = mount();
    component.editor!.commands.setTextSelection(1);
    component.insert("table");
    expect(component.inTable()).toBe(true);
    component.tableAction("rowAfter");
    component.tableAction("columnAfter");
    const reopened = decodeDaily(component.raw);
    expect(reopened.sourceOnly).toBe(false);
    const table = reopened.doc.content?.find((n) => n.type === "table");
    expect(table?.content).toHaveLength(4);
    expect(table?.content?.[0].content).toHaveLength(4);
  });
  it("inserts canonical source and Maple request blocks outside nested containers", () => {
    const component = mount(":::callout info\nNested writing\n:::");
    const editor = component.editor!;
    editor.commands.setTextSelection(3);
    component.insertReference({ v: 1, kind: "email", eventID: "evidence-1" });
    const decoded = decodeDaily(component.raw);
    expect(decoded.sourceOnly).toBe(false);
    expect(decoded.doc.content?.map((node) => node.type)).toContain(
      "sourceReference",
    );
    expect(
      decoded.doc.content?.[0].content?.some(
        (node) => node.type === "sourceReference",
      ),
    ).toBe(false);
    editor.commands.setTextSelection(3);
    component.addRequest();
    expect(editor.state.selection.$from.parent.textContent).toBe("@maple ");
    expect(editor.state.selection.$from.depth).toBe(1);
  });
  it("starts ordinary writing after splitting a Maple request", () => {
    const component = mount(
      '<!-- maple:block {"v":1,"id":"request","kind":"maple-request","requestID":"run-once"} -->\n@maple Find a source.\n',
    );
    const editor = component.editor!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.splitBlock();
    editor.commands.insertContent("My own thought");
    const blocks = decodeDaily(component.raw).doc.content!;
    expect(blocks[0].attrs?.["maple"]).toHaveProperty("requestID", "run-once");
    expect(blocks[1].attrs?.["maple"]).not.toHaveProperty("kind");
    expect(blocks[1].attrs?.["maple"]).not.toHaveProperty("requestID");
    expect(blocks[1].attrs?.["maple"]).not.toHaveProperty("id", "request");
  });
  it("hides the floating controls and prevents toolbar edits for read-only documents", () => {
    const component = mount();
    fixture!.componentRef.setInput("readOnly", true);
    fixture!.detectChanges();
    const before = component.editor!.getJSON();
    component.format("bold");
    component.insert("table");
    expect(component.editor!.getJSON()).toEqual(before);
    expect(fixture!.nativeElement.querySelector('[role="toolbar"]')).toBeNull();
  });
});

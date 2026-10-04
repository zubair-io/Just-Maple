import { TestBed, ComponentFixture } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleEditorComponent } from "./maple-editor.component";
import { AttachmentService } from "./attachment.service";
import { SourcesService } from "../sources/sources.service";
import { Slice, Fragment } from "@tiptap/pm/model";
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
  it.each(["button", "submitAt"])("does not submit or mutate a request during composition via %s", (path) => {
    const component = mount('@maple Find 東京'), editor = component.editor!;
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    const before = editor.getJSON();
    const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
    if (path === "button") fixture!.nativeElement.querySelector(".maple-run-button").click();
    else component.submitAt(0);
    expect(submitted).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(before);
    composing.mockReturnValue(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("のメール");
    component.submitAt(0);
    expect(submitted).toHaveBeenCalledOnce();
    expect(submitted).toHaveBeenLastCalledWith({ blockID: expect.any(String), text: "Find 東京のメール" });
  });
  it("does not submit a raw-mode hidden request or an ordinary paragraph", () => {
    const component = mount('@maple Find sources'), submitted = vi.fn();
    component.submitted.subscribe(submitted);
    component.toggleSource();
    component.sourceChanged("@maple A different request");
    component.submitAt(0);
    expect(submitted).not.toHaveBeenCalled();
    component.toggleSource();
    component.editor!.commands.setContent("<p>Ordinary writing</p>");
    component.submitAt(0);
    expect(submitted).not.toHaveBeenCalled();
  });
  it.each(["Meta", "Control"])("leaves %s+Enter untouched when its event is composing", (modifier) => {
    const component = mount('@maple Find sources'), editor = component.editor!, submitted = vi.fn();
    component.submitted.subscribe(submitted);
    editor.commands.setTextSelection(8);
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, metaKey: modifier === "Meta", ctrlKey: modifier === "Control", cancelable: true });
    editor.options.editorProps.handleKeyDown!(editor.view, event);
    expect(submitted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
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
  it("retains formatted words when Enter immediately follows a native selection collapse", () => {
    const component = mount("Selected emphasis"),
      editor = component.editor!;
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 18 });
    component.format("bold");
    const text = editor.view.dom.querySelector("strong")!.firstChild!;
    const selection = document.getSelection()!;
    selection.collapse(text, text.textContent!.length);
    expect(editor.state.selection.empty).toBe(false);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.state.doc.textContent).toBe("Selected emphasis");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(
      decodeDaily(component.raw).doc.content?.[0].content?.[0].marks,
    ).toContainEqual({ type: "bold" });
  });
  it("propagates read-only into an existing recording NodeView before file copy can start", async () => {
    const importFile = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: AttachmentService, useValue: { importFile, read: vi.fn() } },
      { provide: SourcesService, useValue: { detail: vi.fn().mockResolvedValue({ row: { id: 'recording', type: 'recording', connector: 'recording' }, content: '', truncated: false }) } },
    ] });
    fixture = TestBed.createComponent(MapleEditorComponent);
    fixture.componentRef.setInput('initial', '```maple-ref\n{"v":1,"kind":"recording","eventID":"recording"}\n```');
    fixture.componentRef.setInput('documentID', 'document');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const editor = fixture.componentInstance.editor!;
    const input = fixture.nativeElement.querySelector('input[type=file][accept]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fixture.componentRef.setInput('readOnly', true); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.editor).toBe(editor);
    expect(fixture.nativeElement.querySelector('input[type=file][accept]')).toBeNull();
    // Even a stale file-picker callback from the old control must not copy bytes.
    Object.defineProperty(input, 'files', { value: [new File(['fixture'], 'fixture.wav', { type: 'audio/wav' })] });
    input.dispatchEvent(new Event('change', { bubbles: true })); await fixture.whenStable();
    expect(importFile).not.toHaveBeenCalled();
    fixture.componentRef.setInput('readOnly', false); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=file][accept]')).not.toBeNull();
  });
  it("returns from source card controls to the mapped editor selection with Escape", async () => {
    const component = mount('Writing before.\n\n```maple-ref\n{"v":1,"kind":"email","eventID":"fixture-source"}\n```\n\nWriting after.');
    const editor = component.editor!;
    editor.commands.setTextSelection(5);
    const button = fixture!.nativeElement.querySelector('.source-card-title') as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    const before = editor.state.selection.from;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(editor.view.hasFocus()).toBe(true));
    expect(editor.state.selection.from).toBe(before);
    expect(editor.state.doc.textContent).toContain('Writing before.');
  });
  it("keeps managed clipboard cards out of plain Markdown instead of silently dropping their evidence", () => {
    fixture = TestBed.createComponent(MapleEditorComponent);
    fixture.componentRef.setInput("initial", "Plain writing");
    fixture.componentRef.setInput("storageMode", "markdown");
    fixture.detectChanges();
    const component = fixture.componentInstance,
      editor = component.editor!;
    const before = editor.getJSON();
    const node = editor.schema.nodes["sourceReference"].create({
      reference: { v: 1, kind: "email", eventID: "fixture-email" },
    });
    const handled = editor.view.someProp("handlePaste", (handler) =>
      handler(
        editor.view,
        new Event("paste") as ClipboardEvent,
        new Slice(Fragment.from(node), 0, 0),
      ),
    );
    expect(handled).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(component.notice()).toContain("Enable source blocks");
    expect(component.insertTools.some((tool) => tool.id === "details")).toBe(
      false,
    );
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

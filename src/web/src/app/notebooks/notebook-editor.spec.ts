import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeBridge } from "../core/native-bridge.service";
import { MapleEditorComponent } from "../editor/maple-editor.component";
import { NotebookService } from "./notebook.service";
import { NotebooksComponent } from "./notebooks.component";

const book = {
  id: "book",
  name: "Writing",
  location: "Test folder",
  cloud: false,
  available: true,
  notes: [{ path: "Draft.md", name: "Draft", modifiedAt: 1 }],
};
function setup(
  content = "---\ntitle: Preserve this\n---\n# Draft\n\nA quiet sentence.\n",
  readOnly = false,
) {
  const notebook = vi.fn(async (action: string, data: any) => {
    if (action === "notebookCatalog")
      return { notebooks: [book], cloudAvailable: false };
    if (action === "noteSave")
      return {
        notebookID: "book",
        path: "Draft.md",
        content: data.content,
        revision: "v2",
      };
    return { saved: true };
  });
  TestBed.configureTestingModule({
    providers: [{ provide: NativeBridge, useValue: { notebook } }],
  });
  const notes = TestBed.inject(NotebookService);
  notes.catalog.set({ notebooks: [book], cloudAvailable: false });
  notes.bookID.set("book");
  notes.load({
    notebookID: "book",
    path: "Draft.md",
    content,
    revision: "v1",
    readOnly,
  });
  const fixture = TestBed.createComponent(NotebooksComponent);
  fixture.detectChanges();
  const editor = fixture.debugElement.query(By.directive(MapleEditorComponent))
    .componentInstance as MapleEditorComponent;
  return { fixture, notes, editor, notebook };
}
afterEach(() => TestBed.resetTestingModule());

describe("Shared notebook writing experience", () => {
  it("uses the same floating editor and persists ordinary Markdown without managed metadata", async () => {
    const { fixture, notes, editor, notebook } = setup();
    expect(editor.storageMode()).toBe("markdown");
    expect(editor.editorLabel()).toBe("Note editor");
    expect(
      fixture.nativeElement.querySelector(".maple-floating-tools"),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector(".markdown-tools")).toBeNull();
    expect(
      fixture.nativeElement.querySelector(".note-document-tools"),
    ).toBeNull();
    editor.editor!.commands.setTextSelection(2);
    editor.editor!.commands.insertContent("Revised ");
    expect(await notes.flush()).toBe(true);
    const content = notes.document()!.content;
    expect(content).toContain("title: Preserve this");
    expect(content).toContain("Revised ");
    expect(content).not.toContain("maple:block");
    expect(notebook).toHaveBeenCalledWith(
      "noteSave",
      expect.objectContaining({ revision: "v1", content }),
    );
    fixture.destroy();
  });

  it("renders read-only notes with the shared rich editor and never emits edits", () => {
    const { fixture, editor, notes } = setup(
      "# Reference\n\n- Read this\n",
      true,
    );
    expect(editor.editor!.isEditable).toBe(false);
    expect(
      fixture.nativeElement.querySelector(".ProseMirror h1")?.textContent,
    ).toBe("Reference");
    expect(
      fixture.nativeElement.querySelector(".ProseMirror li")?.textContent,
    ).toContain("Read this");
    expect(
      fixture.nativeElement.querySelector(".maple-floating-tools"),
    ).toBeNull();
    expect(notes.dirty()).toBe(false);
    fixture.destroy();
  });

  it("preserves unsupported Markdown in source mode and keeps recovery actions reachable", () => {
    const raw = "---\ntitle: Keep\n---\n<div>Unusual HTML stays intact</div>\n";
    const { fixture, editor, notes } = setup(raw);
    expect(editor.source()).toBe(true);
    expect(editor.raw).toBe(raw);
    expect(notes.dirty()).toBe(false);
    fixture.nativeElement.querySelector(".note-tools-toggle").click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(".note-document-tools")?.textContent,
    ).toContain("Save a copy");
    expect(
      fixture.nativeElement.querySelector(".note-document-tools")?.textContent,
    ).toContain("Enable source blocks");
    fixture.destroy();
  });
  it("inserts email, message and HA references with their original evidence identity", () => {
    const { fixture, editor } = setup();
    const insert = vi.spyOn(editor, "insertReference").mockReturnValue(true);
    const base = {
      account: "fixture",
      externalID: "fixture",
      revision: "v1",
      sender: "Fixture",
      subject: "Fixture evidence",
      preview: "",
      status: "ready",
      statusDetail: "",
      occurredAt: 1,
      receivedAt: 1,
      stateVersion: 1,
    };
    for (const [type, connector, kind] of [
      ["email.received", "gmail", "email"],
      ["message.received", "imessage", "message"],
      ["state.changed", "home_assistant", "home"],
    ]) {
      fixture.componentInstance.insertSource({
        ...base,
        id: type,
        type,
        connector,
      });
      expect(insert).toHaveBeenLastCalledWith({
        v: 1,
        kind,
        eventID: type,
        label: "Fixture evidence",
      });
    }
    fixture.destroy();
  });
  it("retains the managed editor, all source cards and typing across in-flight autosaves", async () => {
    let saved = {
      documentID: "managed-note",
      notebookID: "book",
      path: "Draft.md",
      content: "# Evidence\n\nKeep this writing.\n",
      revision: "v1",
      readOnly: false,
      day: "",
      blocks: [],
      cleared: [],
    };
    let finishCommit!: () => void;
    let commitCount = 0;
    const notebook = vi.fn(async (action: string, data: any) => {
      if (action === "notebookCatalog")
        return { notebooks: [book], cloudAvailable: false };
      if (action === "documentOpen") return { ...saved };
      if (action === "mapleRuns") return [];
      if (action === "sourceDetail")
        return {
          row: {
            id: data.eventID,
            subject: data.eventID,
            type: "message",
            connector: "fixture",
          },
        };
      if (action === "documentCommit") {
        commitCount++;
        if (commitCount === 1)
          await new Promise<void>((resolve) => (finishCommit = resolve));
        saved = {
          ...saved,
          content: data.content,
          revision: "v" + (commitCount + 1),
        };
        return { ...saved, state: "committed" };
      }
      return { saved: true };
    });
    TestBed.configureTestingModule({
      providers: [{ provide: NativeBridge, useValue: { notebook } }],
    });
    const notes = TestBed.inject(NotebookService);
    notes.catalog.set({ notebooks: [book], cloudAvailable: false });
    notes.bookID.set("book");
    notes.load(saved);
    const fixture = TestBed.createComponent(NotebooksComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.editor).toBeDefined();
    });
    const editor = fixture.componentInstance.editor!;
    const getEditor = () =>
      fixture.debugElement.query(By.directive(MapleEditorComponent))
        .componentInstance;
    const managed = fixture.componentInstance.managed;
    const insert = (eventID: string, kind: string) => {
      editor.editor!.commands.setTextSelection(
        editor.editor!.state.doc.content.size - 1,
      );
      expect(
        editor.insertReference({ v: 1, kind, eventID, label: eventID }),
      ).toBe(true);
      fixture.detectChanges();
    };
    editor.editor!.view.dom.dispatchEvent(new FocusEvent("focus"));
    expect(managed.editing()).toBe(true);
    insert("fixture-email", "email");
    const saving = managed.flush();
    await vi.waitFor(() => expect(commitCount).toBe(1));
    fixture.detectChanges();
    expect(getEditor()).toBe(editor);
    insert("fixture-message", "message");
    insert("fixture-home", "home");
    editor.editor!.commands.insertContent("Typing while save is pending.");
    fixture.detectChanges();
    finishCommit();
    expect(await saving).toBe(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getEditor()).toBe(editor);
    expect(
      notebook.mock.calls.filter(([action]) => action === "documentOpen"),
    ).toHaveLength(1);
    for (const text of [
      "fixture-email",
      "fixture-message",
      "fixture-home",
      "Keep this writing.",
      "Typing while save is pending.",
    ])
      expect(saved.content).toContain(text);
    expect(fixture.nativeElement.querySelectorAll(".source-card")).toHaveLength(
      3,
    );
    expect(managed.dirty()).toBe(false);
    fixture.destroy();
    expect(managed.editing()).toBe(false);
  });
});

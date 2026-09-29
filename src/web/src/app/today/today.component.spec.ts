import { Component, input, output, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayComponent } from "./today.component";
import { TodayDocumentService } from "./today-document.service";
import { MapleEditorComponent } from "../editor/maple-editor.component";
import { SourcesService } from "../sources/sources.service";
@Component({
  selector: "maple-editor",
  standalone: true,
  template:
    '<button (click)="documentToolsRequested.emit()">Document tools</button>',
})
class EditorStub {
  initial = input("");
  documentID = input("");
  showToolbar = input(true);
  readOnly = input(false);
  documentToolsAvailable = input(false);
  dayTransfersAvailable = input(false);
  changed = output<string>();
  editingChanged = output<boolean>();
  inspected = output<string>();
  submitted = output<{ blockID: string; text: string }>();
  sourceRequested = output<void>();
  clearRequested = output<string>();
  documentToolsRequested = output<void>();
  blockTransferRequested = output<{ blockID: string; kind: "move" | "copy" }>();
  source = signal(false);
  toggleSource = vi.fn();
}
function setup() {
  const notes = {
    document: signal<any>({
      documentID: "doc",
      path: "2026-09-27.md",
      readOnly: false,
      capabilities: { taskActions: true },
      cleared: [
        {
          blockID: "cleared",
          kind: "paragraph",
          content: "Preserved cleared writing",
        },
      ],
    }),
    day: signal("2026-09-27"),
    initial: signal("User writing remains here"),
    generation: signal(0),
    error: signal(""),
    openError: signal(""),
    loading: signal(false),
    retryOpen: vi.fn(),
    automaticStatus: signal(""),
    actionBusy: signal(false),
    run: signal(null),
    runs: signal([]),
    pendingSource: signal(null),
    history: signal([
      {
        commandID: "history",
        createdAt: 1,
        state: "committed",
        after: "Preserved prior revision",
      },
    ]),
    operations: signal([]),
    open: vi.fn().mockResolvedValue(true),
    openDocument: vi.fn(),
    pollRun: vi.fn(),
    pollAutomatic: vi.fn(),
    setEditing: vi.fn(),
    cancelPendingReads: vi.fn(),
    loadHistory: vi.fn(),
    blockAction: vi.fn(),
    recoveryCopy: vi.fn(),
    reopen: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: TodayDocumentService, useValue: notes },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: new BehaviorSubject(
            convertToParamMap({ date: "2026-09-27" }),
          ),
          queryParamMap: new BehaviorSubject(convertToParamMap({})),
        },
      },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: SourcesService, useValue: {} },
    ],
  });
  TestBed.overrideComponent(TodayComponent, {
    remove: { imports: [MapleEditorComponent] },
    add: { imports: [EditorStub] },
  });
  const fixture = TestBed.createComponent(TodayComponent);
  fixture.detectChanges();
  return {
    fixture,
    notes,
    editor: fixture.debugElement.query(By.directive(EditorStub))
      .componentInstance as EditorStub,
  };
}
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
describe("Today document tools", () => {
  it("offers an opening retry instead of save recovery when loading a note fails", () => {
    const { fixture, notes, editor } = setup();
    notes.openError.set("iCloud temporarily unavailable");
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Retry opening note");
    expect(fixture.nativeElement.textContent).not.toContain("Retry save");
    expect(fixture.nativeElement.textContent).not.toContain("Save recovery copy");
    const retry = Array.from(fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes("Retry opening note"))!;
    retry.click();
    expect(notes.retryOpen).toHaveBeenCalledOnce();
    notes.loading.set(true);
    fixture.detectChanges();
    expect(editor.readOnly()).toBe(true);
    expect(editor.initial()).toBe("User writing remains here");
  });

  it("updates the relative chip after midnight while preserving the open dated writing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 59));
    const { fixture, notes } = setup();
    expect(fixture.componentInstance.relativeDay()).toBe("Today");
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(fixture.componentInstance.relativeDay()).toBe("Yesterday");
    expect(notes.day()).toBe("2026-09-27");
    expect(notes.open).toHaveBeenCalledTimes(1);
    expect(notes.initial()).toBe("User writing remains here");
    expect(fixture.nativeElement.textContent).toContain("Open today’s note");
  });
  it("opens only the date in the route and ignores stale document query parameters", () => {
    const { fixture, notes } = setup();
    const route = TestBed.inject(ActivatedRoute);
    (route.queryParamMap as BehaviorSubject<any>).next(
      convertToParamMap({ document: "wrong-yesterday-doc" }),
    );
    fixture.detectChanges();
    expect(notes.openDocument).not.toHaveBeenCalled();
    expect(notes.open).toHaveBeenCalledExactlyOnceWith("2026-09-27");
    (route.paramMap as BehaviorSubject<any>).next(
      convertToParamMap({ date: "2026-09-28" }),
    );
    expect(notes.open).toHaveBeenLastCalledWith("2026-09-28");
  });
  it("forwards editing presence and stops automatic refresh polling on leaving Today", () => {
    vi.useFakeTimers();
    const { fixture, notes, editor } = setup();
    editor.editingChanged.emit(true);
    editor.editingChanged.emit(false);
    expect(notes.setEditing.mock.calls).toEqual([[true], [false]]);
    vi.advanceTimersByTime(2000);
    expect(notes.pollAutomatic).toHaveBeenCalledOnce();
    fixture.destroy();
    vi.advanceTimersByTime(4000);
    expect(notes.pollAutomatic).toHaveBeenCalledOnce();
    expect(notes.cancelPendingReads).toHaveBeenCalledOnce();
  });
  it("keeps history and cleared content outside the note until tools are explicitly opened", async () => {
    const { fixture, notes, editor } = setup();
    expect(fixture.nativeElement.querySelector("dialog")).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      "Suggested follow ups",
    );
    expect(fixture.nativeElement.textContent).not.toContain("Organize blocks");
    expect(fixture.nativeElement.textContent).not.toContain(
      "Preserved prior revision",
    );
    expect(notes.loadHistory).not.toHaveBeenCalled();
    editor.documentToolsRequested.emit();
    fixture.detectChanges();
    await Promise.resolve();
    const dialog = fixture.nativeElement.querySelector("dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Preserved prior revision");
    expect(dialog.textContent).toContain("Preserved cleared writing");
    expect(notes.loadHistory).toHaveBeenCalledOnce();
    const restore = Array.from(
      dialog.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.trim() === "Restore block")!;
    restore.click();
    expect(notes.blockAction).toHaveBeenCalledExactlyOnceWith(
      "cleared",
      "restore",
    );
    fixture.componentInstance.closeDocumentTools();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("dialog")).toBeNull();
    expect(notes.initial()).toBe("User writing remains here");
  });
  it("routes inline next-day actions through durable block mutations with the same identity", () => {
    const { notes, editor } = setup();
    editor.blockTransferRequested.emit({
      blockID: "original-block",
      kind: "move",
    });
    editor.blockTransferRequested.emit({
      blockID: "original-block",
      kind: "copy",
    });
    expect(notes.blockAction.mock.calls).toEqual([
      ["original-block", "move", "2026-09-28"],
      ["original-block", "copy", "2026-09-28"],
    ]);
    expect(editor.documentToolsAvailable()).toBe(true);
    expect(editor.dayTransfersAvailable()).toBe(true);
  });
});

import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { afterEach, expect, it, vi } from "vitest";
import { NativeBridge } from "../core/native-bridge.service";
import { TodayDocumentService } from "../today/today-document.service";
import { LinkedTaskComponent } from "./linked-task.component";
import { MapleEditorComponent } from "./maple-editor.component";

let fixture: ComponentFixture<LinkedTaskComponent> | ComponentFixture<MapleEditorComponent>;
function setup(status = "open", scope = "managed-document") {
  const document = signal<any>({ readOnly: false, capabilities: { taskActions: true }, blocks: [{
    blockID: "block-1", taskID: "task:task-1", taskVersion: 2, taskStatus: status,
  }] });
  const notes = { document, actionBusy: signal(false), blockAction: vi.fn(async () => undefined) };
  const state = signal<any>({ world: { tasks: [{ id: "task-1", status, version: 2,
    actionState: { lastMutationScope: scope, lastAction: "done", lastMutationID: "completion-1" },
  }], suggestions: [] } });
  const router = { navigate: vi.fn(async () => true) };
  TestBed.configureTestingModule({ providers: [
    { provide: TodayDocumentService, useValue: notes },
    { provide: NativeBridge, useValue: { state } },
    { provide: Router, useValue: router },
  ] });
  return { notes, state, router };
}
function mount() {
  const result = TestBed.createComponent(LinkedTaskComponent);
  fixture = result;
  result.componentRef.setInput("blockID", "block-1");
  result.componentRef.setInput("label", "Review the fixture estimate");
  result.detectChanges();
  return result;
}
afterEach(() => { fixture?.destroy(); TestBed.resetTestingModule(); delete (window as any).mapleHost; });

it("opens the existing task details without changing canonical state or clearing the note", () => {
  const { router, notes } = setup(); mount();
  fixture.nativeElement.querySelector(".task-title").click();
  expect(router.navigate).toHaveBeenCalledWith(["/tasks", "task-1"]);
  fixture.nativeElement.querySelector(".task-action").click();
  expect(router.navigate).toHaveBeenCalledTimes(2);
  expect(notes.blockAction).not.toHaveBeenCalled();
});
it("completes a linked task explicitly and leaves clear attention a separate action", () => {
  const { notes } = setup(); mount();
  const button = fixture.nativeElement.querySelector(".task-checkbox") as HTMLButtonElement;
  expect(button.title).toContain("Clearing this note is a separate action");
  button.click();
  expect(notes.blockAction).toHaveBeenCalledExactlyOnceWith("block-1", "complete");
});
it("offers scoped undo only for the current unchanged completion from a note", () => {
  const { notes, state } = setup("completed"); const card = mount();
  expect(card.componentInstance.canUndoCompletion()).toBe(true);
  const buttons = [...fixture.nativeElement.querySelectorAll(".task-action")] as HTMLButtonElement[];
  const undo = buttons.find(button => button.textContent?.includes("Undo this note’s completion"))!;
  undo.click();
  expect(notes.blockAction).toHaveBeenCalledExactlyOnceWith("block-1", "reopen");
  state.update(value => ({ world: { ...value.world, tasks: [{ ...value.world.tasks[0], version: 3 }] } }));
  fixture.detectChanges();
  expect(card.componentInstance.canUndoCompletion()).toBe(false);
  expect(fixture.nativeElement.textContent).not.toContain("Undo this note’s completion");
  card.componentInstance.undoCompletion();
  expect(notes.blockAction).toHaveBeenCalledTimes(1);
});
it("routes other completions to shared details instead of presenting a failing scoped undo", () => {
  const { notes, router } = setup("completed", "desktop"); const card = mount();
  expect(card.componentInstance.canUndoCompletion()).toBe(false);
  expect(fixture.nativeElement.querySelector(".task-checkbox").disabled).toBe(true);
  expect(fixture.nativeElement.textContent).not.toContain("Undo this note’s completion");
  card.componentInstance.undoCompletion();
  fixture.nativeElement.querySelector(".task-title").click();
  expect(router.navigate).toHaveBeenCalledWith(["/tasks", "task-1"]);
  expect(notes.blockAction).not.toHaveBeenCalled();
});
it("keeps readonly, busy, missing-version and cancelled tasks from mutating", () => {
  const { notes } = setup(); const card = mount();
  card.componentRef.setInput("readOnly", true); fixture.detectChanges(); card.componentInstance.complete();
  expect(fixture.nativeElement.querySelector(".task-checkbox").disabled).toBe(true);
  card.componentRef.setInput("readOnly", false); notes.actionBusy.set(true); card.componentInstance.complete();
  notes.actionBusy.set(false);
  notes.document.update(doc => ({ ...doc, blocks: [{ ...doc.blocks[0], taskVersion: undefined }] }));
  card.componentInstance.complete();
  notes.document.update(doc => ({ ...doc, blocks: [{ ...doc.blocks[0], taskVersion: 2, taskStatus: "cancelled" }] }));
  fixture.detectChanges(); card.componentInstance.complete();
  expect(fixture.nativeElement.querySelector(".task-checkbox").getAttribute("aria-label")).toBe("Linked task cancelled");
  expect(notes.blockAction).not.toHaveBeenCalled();
});
it("can inspect a source task or a newly inserted reference before registry acknowledgement", () => {
  const { notes, router } = setup(); const card = mount();
  notes.document.update(doc => ({ ...doc, blocks: [] }));
  card.componentRef.setInput("taskID", "source:source-1"); fixture.detectChanges();
  fixture.nativeElement.querySelector(".task-title").click();
  expect(router.navigate).toHaveBeenCalledWith(["/suggestions", "source-1"]);
  expect(fixture.nativeElement.textContent).toContain("State unavailable");
  expect(fixture.nativeElement.querySelector(".task-checkbox").disabled).toBe(true);
});
it("does not expose desktop navigation or canonical mutations in the iPhone readonly editor", () => {
  const { notes, router } = setup("completed"); (window as any).mapleHost = "iphone"; const card = mount();
  expect(fixture.nativeElement.querySelector(".task-title")).toBeNull();
  expect(fixture.nativeElement.querySelector(".task-action")).toBeNull();
  card.componentInstance.inspect(); card.componentInstance.complete(); card.componentInstance.undoCompletion();
  expect(router.navigate).not.toHaveBeenCalled(); expect(notes.blockAction).not.toHaveBeenCalled();
});
it("passes node identity and live readonly state through the shared editor node view", async () => {
  const { notes, router } = setup();
  const editor = TestBed.createComponent(MapleEditorComponent); fixture = editor;
  editor.componentRef.setInput("initial", '<!-- maple:block {"v":1,"id":"block-1","taskID":"task:task-1"} -->\n- [ ] Review the fixture estimate\n');
  editor.detectChanges(); await editor.whenStable(); editor.detectChanges();
  const checkbox = () => editor.nativeElement.querySelector(".task-checkbox") as HTMLButtonElement;
  expect(checkbox()).toBeTruthy(); expect(checkbox().disabled).toBe(false);
  editor.componentRef.setInput("readOnly", true); editor.detectChanges(); await editor.whenStable(); editor.detectChanges();
  expect(checkbox().disabled).toBe(true);
  checkbox().click(); expect(notes.blockAction).not.toHaveBeenCalled();
  editor.nativeElement.querySelector(".task-title").click(); expect(router.navigate).toHaveBeenCalledWith(["/tasks", "task-1"]);
  editor.componentRef.setInput("readOnly", false); editor.detectChanges(); await editor.whenStable(); editor.detectChanges();
  expect(checkbox().disabled).toBe(false);
});

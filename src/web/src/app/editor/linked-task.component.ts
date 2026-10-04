import { Component, ChangeDetectionStrategy, computed, inject, input } from "@angular/core";
import { Router } from "@angular/router";
import { NativeBridge } from "../core/native-bridge.service";
import { isCompanion } from "../core/companion-host";
import { TodayDocumentService } from "../today/today-document.service";
@Component({
  selector: "maple-linked-task",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="linked-task">
    <button class="task-checkbox" type="button"
      [disabled]="!available() || terminal() || notes.actionBusy()"
      [attr.aria-label]="done() ? 'Linked task completed' : terminal() ? 'Linked task cancelled' : 'Complete linked task'"
      [attr.title]="'Completes the shared task everywhere it is linked. Clearing this note is a separate action.'"
      (click)="complete()">{{ done() ? "✓" : "□" }}</button>
    <div class="task-content">
      @if (detailRoute()) {
        <button class="task-title" type="button" [disabled]="notes.actionBusy()" (click)="inspect()"
          [attr.aria-label]="'Open task details: ' + label()">{{ label() }}</button>
      } @else { <span>{{ label() }}</span> }
      <small>Linked task · {{ block()?.taskStatus?.replaceAll('_', ' ') || "State unavailable" }}{{ !available() ? " · Read only" : "" }}</small>
      <div class="task-actions">
        @if (detailRoute()) {
          <button type="button" class="task-action" [disabled]="notes.actionBusy()" (click)="inspect()">Task details</button>
        }
        @if (canUndoCompletion()) {
          <button type="button" class="task-action" [disabled]="notes.actionBusy()" (click)="undoCompletion()"
            title="Reopens the shared task by undoing its latest unchanged completion from a note.">Undo this note’s completion</button>
        }
      </div>
    </div>
  </div>`,
  styles: [`
    .linked-task { display:flex; gap:14px; align-items:start; padding:12px 0; font:20px/1.6 var(--font-serif); }
    .task-content { min-width:0; }
    button { color:var(--color-link,var(--color-primary)); border:0; background:none; padding:0; cursor:pointer; }
    .task-checkbox { font-size:24px; }
    .task-title { display:block; color:var(--color-text-main); font:inherit; text-align:left; overflow-wrap:anywhere; }
    .task-title:hover { text-decoration:underline; text-underline-offset:3px; }
    .task-actions { display:flex; flex-wrap:wrap; gap:8px 16px; }
    .task-action { font:12px/1.6 var(--font-sans); text-align:left; }
    .task-action:hover { text-decoration:underline; }
    button:disabled { cursor:default; opacity:.65; }
    small { display:block; color:var(--color-text-muted); font:12px/1.6 var(--font-sans); }
    button:focus-visible { outline:2px solid var(--color-focus,var(--color-primary)); outline-offset:3px; border-radius:2px; }
  `],
})
export class LinkedTaskComponent {
  readonly blockID = input.required<string>();
  readonly taskID = input("");
  readonly label = input("");
  readonly readOnly = input(false);
  readonly notes = inject(TodayDocumentService);
  private readonly bridge = inject(NativeBridge);
  private readonly router = inject(Router, { optional: true });
  readonly block = computed(() => this.notes.document()?.blocks?.find(block => block.blockID === this.blockID()));
  readonly identity = computed(() => this.block()?.taskID || this.taskID());
  readonly available = computed(() =>
    !this.readOnly() && !isCompanion() && !!this.notes.document()?.capabilities.taskActions &&
    this.block()?.taskVersion !== undefined && !this.notes.document()?.readOnly,
  );
  readonly done = computed(() => ["done", "completed", "complete"].includes(this.block()?.taskStatus ?? ""));
  readonly terminal = computed(() => this.done() || ["cancelled", "canceled"].includes(this.block()?.taskStatus ?? ""));
  readonly detailRoute = computed(() => {
    // iPhone's companion shell has its own task detail view; a desktop Router
    // navigation there would leave a button that appears to do nothing.
    if (!this.router || isCompanion()) return null;
    const match = /^(task|source):(.+)$/.exec(this.identity());
    return match ? [match[1] === "task" ? "/tasks" : "/suggestions", match[2]] : null;
  });
  readonly canUndoCompletion = computed(() => {
    if (!this.available() || !this.done()) return false;
    const id = this.identity(), world = this.bridge.state().world;
    const suggestion = world?.suggestions.find(item => "source:" + item.id === id);
    const task = id.startsWith("task:") ? world?.tasks.find(item => "task:" + item.id === id) : suggestion?.candidate;
    // The native journal permits scoped undo only while no later task change
    // has superseded that completion. General reopen lives in Task details.
    return !!task && (suggestion?.version ?? task.version) === this.block()?.taskVersion &&
      task.status === "completed" && task.actionState?.lastMutationScope === "managed-document" &&
      task.actionState.lastAction === "done";
  });
  inspect() {
    const route = this.detailRoute();
    if (route && !this.notes.actionBusy()) void this.router!.navigate(route); // Existing route guards flush the note before departure.
  }
  complete() {
    if (this.available() && !this.terminal() && !this.notes.actionBusy()) void this.notes.blockAction(this.blockID(), "complete");
  }
  undoCompletion() {
    if (this.canUndoCompletion() && !this.notes.actionBusy()) void this.notes.blockAction(this.blockID(), "reopen");
  }
}

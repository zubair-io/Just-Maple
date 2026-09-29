import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from "@angular/core";
import { TodayDocumentService } from "../today/today-document.service";
@Component({
  selector: "maple-linked-task",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="linked-task">
    <button
      type="button"
      [disabled]="!available() || done() || notes.actionBusy()"
      [attr.aria-label]="done() ? 'Task complete' : 'Complete linked task'"
      (click)="complete()"
    >
      {{ done() ? "✓" : "□" }}
    </button>
    <div>
      <span>{{ label() }}</span
      ><small
        >Linked task · {{ block()?.taskStatus || "State unavailable"
        }}{{ !available() ? " · Read only" : "" }}</small
      >
    </div>
  </div>`,
  styles: [
    `
      .linked-task {
        display: flex;
        gap: 14px;
        align-items: start;
        padding: 12px 0;
        font: 20px/1.6 var(--font-serif);
      }
      button {
        font-size: 24px;
        color: var(--color-link, var(--color-primary));
        border: 0;
        background: none;
        padding: 0;
        cursor: pointer;
      }
      button:disabled {
        cursor: default;
      }
      small {
        display: block;
        color: var(--color-text-muted);
        font: 12px/1.6 var(--font-sans);
      }
      button:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
      }
    `,
  ],
})
export class LinkedTaskComponent {
  readonly blockID = input.required<string>();
  readonly label = input("");
  readonly notes = inject(TodayDocumentService);
  readonly block = computed(() =>
    this.notes
      .document()
      ?.blocks?.find((block) => block.blockID === this.blockID()),
  );
  readonly available = computed(
    () =>
      !!this.notes.document()?.capabilities.taskActions &&
      !!this.block()?.taskVersion &&
      !this.notes.document()?.readOnly,
  );
  readonly done = computed(() =>
    ["done", "completed", "complete"].includes(this.block()?.taskStatus ?? ""),
  );
  complete() {
    void this.notes.blockAction(this.blockID(), "complete");
  }
}

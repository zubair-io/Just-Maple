import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
} from "@angular/core";
import { MuiButtonComponent } from "@maple/ui";
import { LifeTask, isOpen } from "./world.models";
import { WorldService } from "./world.service";
@Component({
  selector: "maple-task-rows",
  standalone: true,
  imports: [MuiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` @for (task of tasks(); track task.id) {
      <article class="task-row" [attr.data-task-id]="task.id">
        <mui-button
          variant="ghost"
          [ariaLabel]="
            isOpen(task) ? 'Complete ' + task.title : 'Reopen ' + task.title
          "
          [disabled]="world.bridge.pending()"
          (pressed)="world.status(task, isOpen(task) ? 'completed' : 'open')"
          >{{ isOpen(task) ? "○" : "✓" }}</mui-button
        >
        <div class="task-row-body">
          <mui-button
            variant="ghost"
            [fullWidth]="true"
            (pressed)="world.go('tasks/' + task.id)"
            >{{ task.title }}</mui-button
          >
          <div class="tag-row">
            @for (id of task.activityIDs; track id) {
              <button
                class="activity-tag"
                (click)="world.go('activities/' + id)"
              >
                {{ world.activity(id)?.name || "Unavailable activity"
                }}{{
                  world.activity(id)?.lifecycle === "archived"
                    ? " · archived"
                    : ""
                }}
              </button>
            }
            @if (task.status === "waiting") {
              <small>Waiting{{ task.assignee ? " on " + task.assignee : "" }} · {{ task.waitingReason }}</small>
            }
          </div>
        </div>
        <span class="task-due">{{ world.dueLabel(task.due) }}</span>
      </article>
    } @empty {
      <p class="empty">No tasks here yet.</p>
    }`,
})
export class TaskRowsComponent {
  readonly tasks = input.required<LifeTask[]>();
  readonly world = inject(WorldService);
  readonly isOpen = isOpen;
}

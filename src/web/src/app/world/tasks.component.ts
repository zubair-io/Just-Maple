import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { MuiButtonComponent, MuiCheckboxComponent } from "@maple/ui";
import { WorldService } from "./world.service";
import { taskInFilter } from "./world.models";
import { RankedTaskRowsComponent } from "./ranked-task-rows.component";
@Component({
  selector: "maple-tasks",
  standalone: true,
  imports: [MuiButtonComponent, MuiCheckboxComponent, RankedTaskRowsComponent],
  templateUrl: "./tasks.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksComponent {
  readonly world = inject(WorldService);
  readonly filter = signal(
    inject(ActivatedRoute).snapshot.queryParamMap.get("filter") || "All open",
  );
  readonly tags = signal<string[]>(inject(ActivatedRoute).snapshot.queryParamMap.getAll("activity"));
  readonly suggestions = computed(() => this.world.pending().filter(s => !this.tags().length || s.candidate.activityIDs.some(id => this.tags().includes(id))));
  readonly filters = [
    "All open",
    "Needs you",
    "Waiting",
    "Today",
    "Upcoming",
    "Completed",
    "Cancelled",
  ];
  readonly tasks = computed(() => this.world.rankedTasks().filter(item =>
    taskInFilter(item.task, this.filter() === 'Suggested' ? 'All open' : this.filter(), this.world.data().asOf) &&
    (!this.tags().length || item.task.activityIDs.some(id => this.tags().includes(id)))));
  toggle(id: string, on: boolean) {
    this.tags.update((ids) =>
      on ? [...ids, id] : ids.filter((i) => i !== id),
    );
  }
}

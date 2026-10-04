import { TaskTimingField } from './task-timing-field';
import { TaskTimingComponent } from './task-timing.component';
import { TaskFactsComponent } from './task-facts.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { DesktopTaskActionsComponent } from './desktop-task-actions.component';
import { TaskEvidenceComponent } from "./task-evidence.component";
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { FormsModule } from "@angular/forms";
import {
  MuiButtonComponent,
  MuiInputComponent,
  MuiCheckboxComponent,
} from "@maple/ui";
import { WorldService } from "./world.service";
import { newTask } from "./world.models";
@Component({
  selector: "maple-suggestion",
  standalone: true,
  imports: [TaskTimingComponent, TaskFactsComponent, DesktopTaskActionsComponent,
    TaskEvidenceComponent,
    FormsModule,
    MuiButtonComponent,
    MuiInputComponent,
    MuiCheckboxComponent,
  ],
  templateUrl: "./suggestion.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionComponent {
  readonly world = inject(WorldService);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly id = computed(() => this.params().get('id')!);
  readonly suggestion = computed(() =>
    this.world.data().suggestions.find((s) => s.id === this.id()),
  );
  draft = newTask();
  readonly dueTiming = new TaskTimingField();
  readonly scheduledTiming = new TaskTimingField();
  readonly loadedVersion = signal<number | undefined>(undefined);
  private loadedID = '';
  private linkedVersion?: number;
  constructor() {
    effect(() => {
      const s = this.suggestion();
      if (this.id() !== this.loadedID) {
        this.loadedID = this.id();
        this.loadedVersion.set(undefined);
      }
      if (s && this.loadedVersion() === undefined) this.reload();
    });
  }
  reload() {
    const s = this.suggestion();
    if (!s) return;
    this.draft = structuredClone(this.world.rankedTasks().find(item => item.id === 'source:' + s.id)?.task ?? s.candidate);
    this.linkedVersion = this.world.data().tasks.find(t => t.id === s.linkedTaskID)?.version;
    this.dueTiming.load(this.draft.due);
    this.scheduledTiming.load(this.draft.scheduled);
    this.loadedVersion.set(s.version);
  }
  tag(id: string, on: boolean) {
    this.draft.activityIDs = on
      ? [...new Set([...this.draft.activityIDs, id])]
      : this.draft.activityIDs.filter((i) => i !== id);
  }
  async review(decision: string) {
    const s = this.suggestion();
    if (!s) return;
    const expectedVersion = decision === "accept" ? this.loadedVersion() : s.version;
    if (expectedVersion === undefined) return;
    const record = {
      ...this.draft,
      due: this.dueTiming.value(),
      scheduled: this.scheduledTiming.value(),
    };
    await this.world.bridge.act({
      action: "reviewSuggestion",
      id: s.id,
      decision,
      record: decision === "accept" ? record : undefined,
      expectedVersion,
      expectedTaskVersion: this.linkedVersion,
      requestID: this.world.request({
        s: s.id,
        v: expectedVersion,
        decision,
        record,
      }),
    });
  }
}

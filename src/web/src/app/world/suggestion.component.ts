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
import { SourceEvent } from "../core/native-bridge.service";
import { newTask } from "./world.models";
@Component({
  selector: "maple-suggestion",
  standalone: true,
  imports: [DesktopTaskActionsComponent,
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
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id")!;
  readonly suggestion = computed(() =>
    this.world.data().suggestions.find((s) => s.id === this.id),
  );
  readonly source = signal<SourceEvent | null>(null);
  async evidence() {const s=this.suggestion(); if(s) {try {this.source.set(await this.world.bridge.evidence(s.eventID));} catch {}}}
  draft = newTask();
  dueDate = "";
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private loaded = false;
  private linkedVersion?: number;
  constructor() {
    effect(() => {
      const s = this.suggestion();
      if (s && !this.loaded) {
        this.draft = structuredClone(this.world.rankedTasks().find(item => item.id === "source:" + s.id)?.task ?? s.candidate);
        this.linkedVersion = this.world.data().tasks.find(t => t.id === s.linkedTaskID)?.version;
        this.dueDate = s.candidate.due?.date ?? "";
        this.loaded = true;
      }
    });
  }
  tag(id: string, on: boolean) {
    this.draft.activityIDs = on
      ? [...new Set([...this.draft.activityIDs, id])]
      : this.draft.activityIDs.filter((i) => i !== id);
  }
  async review(decision: string) {
    const s = this.suggestion();
    if (!s) return;
    const record = {
      ...this.draft,
      due: this.dueDate
        ? { kind: "date" as const, date: this.dueDate, timeZone: this.zone }
        : undefined,
    };
    await this.world.bridge.act({
      action: "reviewSuggestion",
      id: s.id,
      decision,
      record: decision === "accept" ? record : undefined,
      expectedVersion: s.version,
      expectedTaskVersion: this.linkedVersion,
      requestID: this.world.request({
        s: s.id,
        v: s.version,
        decision,
        record,
      }),
    });
  }
}

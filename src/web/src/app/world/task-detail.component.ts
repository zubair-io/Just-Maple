import { taskRoot } from './task-ranking';
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
import { toSignal } from "@angular/core/rxjs-interop";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  MuiButtonComponent,
  MuiInputComponent,
  MuiCheckboxComponent,
} from "@maple/ui";
import { WorldService } from "./world.service";
import { LifeTask, newTask, Series, localDate, isOpen } from "./world.models";
import { SourceEvent } from "../core/native-bridge.service";
@Component({
  selector: "maple-task-detail",
  standalone: true,
  imports: [DesktopTaskActionsComponent,
    TaskEvidenceComponent,
    DatePipe,
    FormsModule,
    MuiButtonComponent,
    MuiInputComponent,
    MuiCheckboxComponent,
  ],
  templateUrl: "./task-detail.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailComponent {
  readonly world = inject(WorldService);
  readonly waitingParent = computed(() => {
    const link=this.record()?.waitingFollowUp;if(!link)return null;
    const world=this.world.data();let id=link.parentNodeID;
    const accepted=world.suggestions.find(s=>'source:'+s.id===id)?.acceptedTaskID;
    if(accepted)id='task:'+accepted;
    id=taskRoot(id,world);
    const task=id.startsWith('task:')?world.tasks.find(t=>'task:'+t.id===id):world.suggestions.find(s=>'source:'+s.id===id)?.candidate;
    return task?{id,title:task.title}:null;
  });
  openWaitingParent(){const parent=this.waitingParent();if(parent)this.world.go(parent.id.startsWith('task:')?'tasks/'+parent.id.slice(5):'suggestions/'+parent.id.slice(7));}

  readonly route = inject(ActivatedRoute);
  readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly id = computed(() => this.params().get("id")!);
  readonly record = computed(() =>
    this.world.data().tasks.find((t) => t.id === this.id()),
  );
  readonly editing = signal(false);
  readonly source = signal<SourceEvent | null>(null);
  readonly isOpen = isOpen;
  draft = newTask();
  dueKind = "none";
  dueDate = "";
  dueTime = "";
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  scheduledDate = "";
  conditionValue = "";
  peopleText = "";
  repeat = "none";
  repeatTime = "07:45";
  repeatStart = localDate(Date.now() / 1000, this.zone);
  scope = "occurrence";
  private loadedID = "";
  constructor() {
    effect(() => {
      const id = this.id(),
        record = this.record();
      if (id !== this.loadedID) {
        this.loadedID = id;
        this.editing.set(id === "new");
        this.load(record ?? newTask());
        const activity = this.route.snapshot.queryParamMap?.get("activity");
        if (id === "new" && activity && this.world.activity(activity)) this.draft.activityIDs = [activity];
      } else if (record && !this.editing()) this.load(record);
    });
  }
  load(task: LifeTask) {
    this.draft = structuredClone(task);
    this.dueKind = task.due?.kind ?? "none";
    this.zone =
      task.due?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.dueDate = task.due?.date ?? "";
    this.dueTime = task.due?.instant
      ? new Date(
          task.due.instant * 1000 -
            new Date(task.due.instant * 1000).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
    this.scheduledDate = task.scheduled?.date ?? "";
    this.conditionValue = task.conditions.find(c => c.subject === "person:self" && c.property === "presence")?.value ?? "";
    this.peopleText = task.people.join(", ");
  }
  edit() {
    if (this.record()) this.load(this.record()!);
    this.editing.set(true);
  }
  reload() {
    if (this.record()) this.load(this.record()!);
  }
  tag(id: string, on: boolean) {
    this.draft.activityIDs = on
      ? [...new Set([...this.draft.activityIDs, id])]
      : this.draft.activityIDs.filter((i) => i !== id);
  }
  async save() {
    const draft = structuredClone(this.draft);
    draft.due =
      this.dueKind === "none"
        ? undefined
        : this.dueKind === "date"
          ? { kind: "date", date: this.dueDate, timeZone: this.zone }
          : {
              kind: "instant",
              date: "",
              instant: new Date(this.dueTime).getTime() / 1000,
              timeZone: this.zone,
            };
    draft.scheduled = this.scheduledDate
      ? { kind: "date", date: this.scheduledDate, timeZone: this.zone }
      : undefined;
    draft.people = this.peopleText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    draft.conditions = [...draft.conditions.filter(c => c.subject !== "person:self" || c.property !== "presence"), ...(this.conditionValue
      ? [
          {
            subject: "person:self",
            property: "presence",
            value: this.conditionValue,
          },
        ]
      : [])];
    if (this.repeat !== "none" && this.id() === "new") {
      const series: Series = {
        id: draft.id,
        template: draft,
        frequency: this.repeat as "daily" | "weekly",
        timeZone: this.zone,
        startDate: this.repeatStart,
        localTime: this.repeatTime,
        paused: false,
        version: 0,
      };
      if (
        await this.world.bridge.act({
          action: "saveSeries",
          record: series,
          expectedVersion: 0,
          requestID: this.world.request(series),
        })
      )
        this.world.go("tasks");
      return;
    }
    if (this.scope === "future" && draft.seriesID) {
      const current = this.world
        .data()
        .series.find((s) => s.id === draft.seriesID);
      if (current) {
        const series = { ...current, template: draft };
        if (
          await this.world.bridge.act({
            action: "saveSeries",
            record: series,
            expectedVersion: series.version,
            requestID: this.world.request(series),
          })
        ) {
          this.editing.set(false);
        }
        return;
      }
    }
    if (await this.world.saveTask(draft)) {
      this.editing.set(false);
      this.world.go("tasks/" + draft.id);
    }
  }
  async evidence(id: string) {
    try {
      this.source.set(await this.world.bridge.evidence(id));
    } catch {}
  }
  async pauseSeries() {
    const series = this.world
      .data()
      .series.find((s) => s.id === this.record()?.seriesID);
    if (series) {
      const record = { ...series, paused: !series.paused };
      await this.world.bridge.act({
        action: "saveSeries",
        record,
        expectedVersion: record.version,
        requestID: this.world.request(record),
      });
    }
  }
  history() {
    return this.world
      .data()
      .history.filter((h) => h.subjects.includes(this.id()));
  }
}

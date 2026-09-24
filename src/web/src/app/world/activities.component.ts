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
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { MuiButtonComponent, MuiInputComponent, MuiCheckboxComponent } from "@maple/ui";
import { WorldService } from "./world.service";
import { Activity, newActivity } from "./world.models";
import { SourceEvent } from "../core/native-bridge.service";
import { RankedTaskRowsComponent } from "./ranked-task-rows.component";
@Component({
  selector: "maple-activities",
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    MuiButtonComponent,
    MuiInputComponent,
    MuiCheckboxComponent,
    RankedTaskRowsComponent,
  ],
  templateUrl: "./activities.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivitiesComponent {
  readonly world = inject(WorldService);
  readonly route = inject(ActivatedRoute);
  readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly id = computed(() => this.params().get("id"));
  readonly activity = computed(() => this.world.activity(this.id() ?? ""));
  readonly ranked = computed(() => this.world.rankedTasks().filter(i => i.task.activityIDs.includes(this.id() ?? "")));
  readonly suggestions = computed(() => this.world.pending().filter(s => s.candidate.activityIDs.includes(this.id() ?? "")));
  readonly editing = signal(false);
  readonly source = signal<SourceEvent | null>(null);
  readonly people = computed(() => [...new Set(this.world.activityTasks(this.id() ?? "").flatMap(t => t.people))]);
  readonly evidenceIDs = computed(() => [...new Set(this.world.activityTasks(this.id() ?? "").flatMap(t => t.evidenceIDs))]);
  async evidence(id: string) {try {this.source.set(await this.world.bridge.evidence(id));} catch {}}
  draft = newActivity();
  private loadedID: string | null = null;
  constructor() {
    effect(() => {
      const id = this.id(),
        a = this.activity();
      if (id !== this.loadedID) {
        this.loadedID = id;
        this.editing.set(id === "new");
        this.draft = structuredClone(a ?? newActivity());
      } else if (a && !this.editing()) this.draft = structuredClone(a);
    });
  }
  targetID = ''; splitName = ''; selected = new Set<string>();
  select(id:string,on:boolean) {if(on)this.selected.add(id);else this.selected.delete(id);}
  async regroup(merge:boolean) {
    const source=this.activity();if(!source)return;
    const target=this.targetID ? this.world.activity(this.targetID) : {...newActivity(),name:this.splitName.trim(),purpose:''};
    if(!target?.name)return;
    const payload={action:'regroupActivity' as const,id:source.id,record:target,ids:[...this.selected],merge,expectedVersion:this.world.data().revision};
    if(await this.world.bridge.act({...payload,requestID:this.world.request(payload)})) {this.selected.clear();this.world.go('activities/'+target.id);}
  }
  async remove() {
    const a=this.activity(); if(!a)return;
    if(await this.world.bridge.act({action:'removeActivity',id:a.id,expectedVersion:a.version,requestID:this.world.request({remove:a.id,version:a.version})})) this.world.go('activities');
  }
  readonly links = computed(() => (this.world.data().activityEvidence ?? []).filter(e=>e.activityID===this.id()));
  edit() {
    this.draft = structuredClone(this.activity()!);
    this.editing.set(true);
  }
  async save() {
    if (await this.world.saveActivity(this.draft)) {
      this.editing.set(false);
      this.world.go("activities/" + this.draft.id);
    }
  }
  async lifecycle(lifecycle: Activity["lifecycle"]) {
    const a = this.activity();
    if (a) await this.world.saveActivity({ ...a, lifecycle });
  }
  list(kind: string) {
    return this.world
      .data()
      .activities.filter((a) => a.kind === kind && a.lifecycle !== "archived");
  }
  history() {
    return this.world
      .data()
      .history.filter((h) => h.subjects.includes(this.id()!));
  }
}

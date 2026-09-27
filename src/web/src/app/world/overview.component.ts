import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { MuiButtonComponent } from "@maple/ui";
import { OverviewSurfaceComponent } from "./overview-surface.component";
import { RankedTaskRowsComponent } from "./ranked-task-rows.component";
import { isOpen } from "./world.models";
import { WorldService } from "./world.service";
@Component({
  selector: "maple-overview",
  standalone: true,
  imports: [MuiButtonComponent, DatePipe, RankedTaskRowsComponent, OverviewSurfaceComponent],
  templateUrl: "./overview.component.html",
  styleUrl: "./overview.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  readonly world = inject(WorldService);
  readonly attention = computed(() => this.world.rankedTasks().filter(i => isOpen(i.task) && i.task.status !== "waiting" && (i.task.actionState?.resurfaceAt ?? 0)<=this.world.data().asOf).slice(0, 5));
  readonly waiting = computed(() => this.world.rankedTasks().filter(i => i.task.status === 'waiting').length);
  // Keep the audit trail in History; Overview excludes ingestion and transport churn.
  readonly recentChanges = computed(() => this.world.data().history.filter(entry =>
    !/^(source|transport|sync|connector|index)\./.test(entry.type) && !entry.type.endsWith('.reprocessed')).slice(0, 2));
  readonly total = computed(() => this.world.rankedTasks().filter(i => isOpen(i.task) && i.task.status !== "waiting" && (i.task.actionState?.resurfaceAt ?? 0)<=this.world.data().asOf).length);
  readonly greeting = computed(() => {const hour=new Date(this.world.data().asOf*1000).getHours();return hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';});
  readonly s = this.world.bridge.state;
  readonly nowStates = computed(() =>
    this.world
      .data()
      .states.filter(
        (s) =>
          ["known", "conflicting"].includes(s.status) &&
          s.subject === "person:self" &&
          ["presence", "currentBehavior", "availability", "employment", "role", "projects", "travel"].includes(s.property),
      ),
  );
  readonly currentActivities = computed(() =>
    this.world.data().activities.filter((a) => a.lifecycle === "active"),
  );
  readonly overviewActivities = computed(() => this.currentActivities().map(a => ({id:a.id,name:a.name,detail:this.world.state(a.id,'milestone')?.value || (a.kind==='area'?'Ongoing':'No state yet'),openTaskCount:this.world.visibleCount(a.id)})));
  inspectProperty(property:string) {const state=this.nowStates().find(s=>s.property===property);if(state)this.world.inspect(state);}
  readonly next = computed(
    () =>
      [...this.s().appleCalendar, ...this.s().googleCalendar]
        .filter((e) => e.start > this.world.data().asOf)
        .sort((a, b) => a.start - b.start)[0],
  );
  task(id: string) {
    return this.world.data().tasks.find((t) => t.id === id);
  }
  ack(id: string, snooze = false) {
    void this.world.bridge.act({
      action: "acknowledgeAttention",
      id,
      until: snooze ? Date.now() / 1000 + 3600 : undefined,
      expectedVersion: this.world.data().revision,
      requestID: crypto.randomUUID(),
    });
  }
}

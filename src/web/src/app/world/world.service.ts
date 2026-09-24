import { computed, inject, Injectable } from "@angular/core";
import { rankTasks } from "./task-ranking";
import { Router } from "@angular/router";
import { NativeBridge, Command } from "../core/native-bridge.service";
import {
  emptyWorld,
  LifeTask,
  TaskStatus,
  isOpen,
  dueLabel,
  Activity,
  Projection,
} from "./world.models";
@Injectable({ providedIn: "root" })
export class WorldService {
  readonly bridge = inject(NativeBridge);
  readonly router = inject(Router);
  readonly data = computed(() => this.bridge.state().world ?? emptyWorld);
  readonly openTasks = computed(() => this.data().tasks.filter(isOpen));
  readonly pending = computed(() =>
    this.data().suggestions.filter((s) => s.reviewStatus === "pending"),
  );
  readonly rankedTasks = computed(() => rankTasks(this.data()));
  private requests = new Map<string, string>();
  readonly dueLabel = dueLabel;
  go(path: string) {
    void this.router.navigateByUrl("/" + path);
  }
  activity(id: string) {
    return this.data().activities.find((a) => a.id === id);
  }
  activityTasks(id: string) {
    return this.data().tasks.filter((t) => t.activityIDs.includes(id));
  }
  suggestedCount(id: string) {return this.pending().filter(s => s.candidate.activityIDs.includes(id)).length;}
  visibleCount(id: string) {return this.rankedTasks().filter(i=>isOpen(i.task) && i.task.activityIDs.includes(id)).length;}
  openCount(id: string) {
    return this.activityTasks(id).filter(isOpen).length;
  }
  state(subject: string, property: string) {
    return this.data().states.find(
      (s) => s.subject === subject && s.property === property,
    );
  }
  request(payload: unknown) {
    const key = JSON.stringify(payload);
    if (!this.requests.has(key)) {
      if (this.requests.size > 50) this.requests.clear();
      this.requests.set(key, crypto.randomUUID());
    }
    return this.requests.get(key)!;
  }
  async saveTask(record: LifeTask) {
    return this.bridge.act({
      action: "saveTask",
      record,
      expectedVersion: record.version,
      requestID: this.request(record),
    });
  }
  async saveActivity(record: Activity) {
    return this.bridge.act({
      action: "saveActivity",
      record,
      expectedVersion: record.version,
      requestID: this.request(record),
    });
  }
  async status(task: LifeTask, status: TaskStatus) {
    return this.saveTask({ ...task, status });
  }
  inspect(state: Projection) {
    this.go(
      "state/" + encodeURIComponent(state.subject) + "/" + state.property,
    );
  }
}

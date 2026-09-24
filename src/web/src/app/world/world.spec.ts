import { TestBed } from "@angular/core/testing";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { emptySnapshot, NativeBridge } from "../core/native-bridge.service";
import {
  emptyWorld,
  newActivity,
  newTask,
  taskInFilter,
  dueLabel,
} from "./world.models";
import { WorldService } from "./world.service";
import { TasksComponent } from "./tasks.component";
import { TaskDetailComponent } from "./task-detail.component";
import { OverviewComponent } from "./overview.component";
import { ActivitiesComponent } from "./activities.component";
function setup(id: string | null = null) {
  const params = convertToParamMap(id ? { id } : {});
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: params, queryParamMap: convertToParamMap({}) },
          paramMap: of(params),
        },
      },
    ],
  });
  const bridge = TestBed.inject(NativeBridge);
  bridge.state.set({
    ...emptySnapshot,
    loaded: true,
    step: -1,
    name: "Test",
    world: { ...emptyWorld, asOf: Date.UTC(2026, 8, 22, 16) / 1000 },
  });
  return bridge;
}
describe("State, Activities and Tasks UI", () => {
  it("renders a shared task once with both activity links and OR filtering", async () => {
    const bridge = setup();
    const a = { ...newActivity(), name: "Family" },
      b = { ...newActivity(), name: "Health" },
      task = { ...newTask(), title: "Appointment", activityIDs: [a.id, b.id] };
    bridge.state.update((s) => ({
      ...s,
      world: { ...s.world!, activities: [a, b], tasks: [task] },
    }));
    const fixture = TestBed.createComponent(TasksComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.tags.set([a.id, b.id]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll("[data-task-id]").length,
    ).toBe(1);
    expect(fixture.nativeElement.textContent).toContain("Family");
    expect(fixture.nativeElement.textContent).toContain("Health");
  });
  it("shows actionable source details and filters suggested tasks by either activity", async () => {
    const bridge = setup();
    const a={...newActivity(),name:"Job Search"}, b={...newActivity(),name:"Employer"};
    const candidate={...newTask(),title:"Send interview availability to the recruiter",description:"Provide available times for the next interview.",activityIDs:[a.id,b.id]};
    const suggestion={id:"suggested",candidate,eventID:"source",fingerprint:"f",sourceKey:"s",quote:"Please send availability",provider:"fixture",deadlineExplanation:"No deadline stated.",reviewStatus:"pending",possibleDuplicateIDs:[],version:1,createdAt:0,sourceSubject:"Next interview",sourceSender:"Recruiter"};
    bridge.state.update(s=>({...s,world:{...s.world!,activities:[a,b],suggestions:[suggestion]}}));
    const fixture=TestBed.createComponent(TasksComponent);
    fixture.componentInstance.tags.set([a.id,b.id]);fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('[data-suggestion-id]').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain("Next interview");
    expect(fixture.nativeElement.textContent).toContain("Provide available times");
    expect(fixture.nativeElement.querySelectorAll('.activity-tag').length).toBe(2);
    fixture.componentInstance.tags.set(["unrelated"]);fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-suggestion-id]').length).toBe(0);
  });
  it("keeps a task edit draft after a failed save and incoming snapshot", async () => {
    const task = { ...newTask(), title: "Original", version: 1 };
    const bridge = setup(task.id);
    bridge.state.update((s) => ({
      ...s,
      world: { ...s.world!, tasks: [task] },
    }));
    const fixture = TestBed.createComponent(TaskDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.edit();
    fixture.componentInstance.draft.title = "Unsaved draft";
    vi.spyOn(bridge, "act").mockResolvedValue(false);
    await fixture.componentInstance.save();
    bridge.state.update((s) => ({
      ...s,
      world: {
        ...s.world!,
        revision: 2,
        tasks: [{ ...task, version: 2, title: "Other edit" }],
      },
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.draft.title).toBe("Unsaved draft");
    expect(fixture.componentInstance.editing()).toBe(true);
  });
  it("bounds Overview while keeping dated waiting tasks and transport history out of Needs you", async () => {
    const bridge=setup();
    const waiting={...newTask(),id:'waiting',title:'Waiting for a response',status:'waiting' as const,due:{kind:'date' as const,date:'2026-09-01',timeZone:'UTC'}};
    const tasks=[waiting,...Array.from({length:8},(_,i)=>({...newTask(),id:'task-'+i,title:'Action '+i}))];
    const activities=Array.from({length:9},(_,i)=>({...newActivity(),id:'area-'+i,name:'Area '+i}));
    const history=['source.gmail.email.received','transport.uploaded','task.completed','state.corrected'].map((type,i)=>({id:String(i),sequence:i,subjects:[],type,effectiveAt:1,recordedAt:1,actor:'fixture',correlationID:'fixture'}));
    bridge.state.update(s=>({...s,world:{...s.world!,tasks,activities,history}}));
    const fixture=TestBed.createComponent(OverviewComponent);fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('[attention] [data-task-id]')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('[attention]').textContent).not.toContain(waiting.title);
    expect(fixture.nativeElement.textContent).toContain('Waiting · 1');
    expect(fixture.nativeElement.querySelectorAll('.activity-card')).toHaveLength(6);
    expect([...fixture.nativeElement.querySelectorAll('.activity-card h3')].map((e:any)=>e.textContent)).toEqual(activities.slice(0,6).map(a=>a.name));
    expect(fixture.nativeElement.querySelector('.recent-strip').textContent).not.toContain('source gmail');
    expect(fixture.nativeElement.querySelector('.recent-strip').textContent).not.toContain('transport uploaded');
    expect(fixture.nativeElement.querySelector('.recent-strip').textContent).toContain('task completed');
    const go=vi.spyOn(fixture.componentInstance.world,'go').mockImplementation(()=>{});
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('View all activities'))!.click();
    expect(go).toHaveBeenCalledWith('activities');
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('Waiting ·'))!.click();
    expect(go).toHaveBeenCalledWith('tasks?filter=Waiting');
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('View all Needs you'))!.click();
    expect(go).toHaveBeenCalledWith('tasks?filter=Needs%20you');
    expect(bridge.state().world!.history).toHaveLength(4);
    fixture.destroy();
    const all=TestBed.createComponent(TasksComponent);all.detectChanges();await all.whenStable();
    expect(all.nativeElement.textContent).toContain(waiting.title);
    all.componentInstance.filter.set('Needs you');all.detectChanges();
    expect(all.nativeElement.textContent).not.toContain(waiting.title);
    expect(all.nativeElement.querySelectorAll('[data-task-id]')).toHaveLength(8);
    all.componentInstance.filter.set('Waiting');all.detectChanges();
    expect(all.nativeElement.textContent).toContain(waiting.title);
    expect(all.nativeElement.querySelectorAll('[data-task-id]')).toHaveLength(1);
    expect(taskInFilter(waiting,'Needs you',Date.now()/1000)).toBe(false);
    expect(taskInFilter(waiting,'Waiting',Date.now()/1000)).toBe(true);
    expect(taskInFilter({...waiting,status:'completed'},'Waiting',Date.now()/1000)).toBe(false);
  });
  it("keeps first-day Overview unknown without fabricated normal state or example activities", async () => {
    setup();
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain("No current state has enough evidence yet");
    expect(text).not.toContain("House normal");
    expect(text).not.toContain("Job Search");
    expect(text).toContain("Add an activity");
  });
  it("shows supporting observations for an activity with no tasks", async () => {
    const activity={...newActivity(),id:'observation-activity',name:'Fixture garden planning'};
    const bridge=setup(activity.id);
    bridge.state.update(s=>({...s,world:{...s.world!,activities:[activity],activityEvidence:[{activityID:activity.id,suggestionID:'observation:source',eventID:'source',reason:'Two garden planning sources',quote:'Garden planning meeting'}]}}));
    const fixture=TestBed.createComponent(ActivitiesComponent);
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Supporting evidence');
    expect(fixture.nativeElement.textContent).toContain('Garden planning meeting');
    expect(fixture.nativeElement.textContent).toContain('Inspect supporting source');
  });
  it("counts canonical nonterminal tasks, excluding pending suggestions", () => {
    const bridge = setup(),
      a = newActivity(),
      task = { ...newTask(), activityIDs: [a.id] };
    bridge.state.update((s) => ({
      ...s,
      world: { ...s.world!, activities: [a], tasks: [task] },
    }));
    const world = TestBed.inject(WorldService);
    expect(world.openCount(a.id)).toBe(1);
    bridge.state.update((s) => ({
      ...s,
      world: { ...s.world!, tasks: [{ ...task, status: "completed" }] },
    }));
    expect(world.openCount(a.id)).toBe(0);
  });
  it("classifies Today and Upcoming using due interpretation timezone and keeps date-only labels", () => {
    const now = Date.UTC(2026, 8, 22, 2) / 1000;
    const task = {
      ...newTask(),
      due: {
        kind: "date" as const,
        date: "2026-09-21",
        timeZone: "America/Los_Angeles",
      },
    };
    expect(taskInFilter(task, "Today", now)).toBe(true);
    expect(taskInFilter(task, "Upcoming", now)).toBe(false);
    expect(dueLabel(task.due)).toBe("2026-09-21");
    expect(taskInFilter(newTask(), "Today", now)).toBe(false);
  });
  it("has an independent Activity editor with no required outcome for areas", async () => {
    setup("new");
    const fixture = TestBed.createComponent(ActivitiesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.draft.kind).toBe("area");
    expect(fixture.componentInstance.draft.purpose).toBe("");
    expect(fixture.nativeElement.textContent).toContain("optional");
  });
});

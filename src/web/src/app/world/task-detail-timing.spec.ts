import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { TaskDetailComponent } from './task-detail.component';
import { SuggestionComponent } from './suggestion.component';
import { emptyWorld, newTask, Suggestion, WorldSnapshot } from './world.models';
import { TaskTimingField } from './task-timing-field';

function setup(data: WorldSnapshot, id: string) {
  const state = signal({ world: data }), requests: any[] = [];
  const bridge = { state, pending: signal(false), act: vi.fn(async (request: any) => { requests.push(request); return true; }) };
  const params = new BehaviorSubject(convertToParamMap({ id }));
  TestBed.configureTestingModule({providers:[
    {provide: NativeBridge, useValue: bridge},
    {provide: Router, useValue: {navigateByUrl: vi.fn()}},
    {provide: ActivatedRoute, useValue: {paramMap: params, snapshot: {paramMap: params.value, queryParamMap: convertToParamMap({})}}},
  ]});
  return {state, requests, params};
}
function suggestion(id: string, title = 'Synthetic source action'): Suggestion {
  return {id, candidate: {...newTask(), title, assignee:'Synthetic owner', due:{kind:'instant',date:'',instant:1790784023.125,timeZone:'Asia/Tokyo'},scheduled:{kind:'date',date:'2026-10-02',timeZone:'Europe/London'}},
    eventID:'fixture-'+id, fingerprint:id, sourceKey:id, quote:'Synthetic quoted request', provider:'synthetic-provider',confidence:.93,deadlineExplanation:'Explicit timing in fixture',reviewStatus:'pending',possibleDuplicateIDs:[],version:2,createdAt:1};
}
afterEach(() => TestBed.resetTestingModule());
describe('task editing preserves supported timing', () => {
  it('retains sub-minute exact due and follow-up schedule when only title changes', async () => {
    const task = {...newTask(),id:'fixture-task',version:3,title:'Synthetic review',due:{kind:'instant' as const,date:'',instant:1790784023.125,timeZone:'Asia/Tokyo'},scheduled:{kind:'instant' as const,date:'',instant:1790697617.75,timeZone:'America/Chicago'}};
    const env=setup({...structuredClone(emptyWorld),tasks:[task]},task.id);
    const fixture=TestBed.createComponent(TaskDetailComponent);fixture.detectChanges();
    fixture.componentInstance.edit();fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#scheduled-kind').value).toBe('instant');
    fixture.componentInstance.draft.title='Renamed synthetic review';
    await fixture.componentInstance.save();
    expect(env.requests[0].record).toMatchObject({title:'Renamed synthetic review',due:task.due,scheduled:task.scheduled});
    expect(env.requests[0].expectedVersion).toBe(3);
  });
  it('preserves independently zoned scheduled dates and supports explicit clearing', async () => {
    const task={...newTask(),id:'date-task',due:{kind:'date' as const,date:'2026-10-03',timeZone:'Asia/Tokyo'},scheduled:{kind:'date' as const,date:'2026-10-02',timeZone:'America/Los_Angeles'}};
    const env=setup({...structuredClone(emptyWorld),tasks:[task]},task.id);
    const fixture=TestBed.createComponent(TaskDetailComponent);fixture.detectChanges();fixture.componentInstance.edit();
    fixture.componentInstance.draft.description='An unrelated detail';await fixture.componentInstance.save();
    expect(env.requests[0].record.scheduled).toEqual(task.scheduled);
    fixture.componentInstance.edit();fixture.componentInstance.scheduledTiming.kind='none';await fixture.componentInstance.save();
    expect(env.requests[1].record.scheduled).toBeUndefined();
    expect(env.requests[1].record.due).toEqual(task.due);
  });
  it('accepting a detected action preserves exact due and schedule and renders primary facts', async () => {
    const s=suggestion('first'),env=setup({...structuredClone(emptyWorld),suggestions:[s]},s.id);
    const fixture=TestBed.createComponent(SuggestionComponent);fixture.detectChanges();
    fixture.componentInstance.draft.title='Reviewed action';await fixture.componentInstance.review('accept');
    expect(env.requests[0]).toMatchObject({action:'reviewSuggestion',expectedVersion:2,record:{title:'Reviewed action',due:s.candidate.due,scheduled:s.candidate.scheduled}});
    expect(fixture.nativeElement.querySelector('maple-task-facts').textContent).toContain('Synthetic owner');
    const analysis=[...fixture.nativeElement.querySelectorAll('details')].find((node:any)=>node.textContent.includes('synthetic-provider')) as HTMLDetailsElement;
    expect(analysis).toBeTruthy();expect(analysis.open).toBe(false);
  });
  it('uses the draft version after a live update and reloads state on reused suggestion routes', async () => {
    const first=suggestion('first'),second=suggestion('second','Another synthetic action');
    const env=setup({...structuredClone(emptyWorld),suggestions:[first,second]},first.id);
    const fixture=TestBed.createComponent(SuggestionComponent);fixture.detectChanges();
    fixture.componentInstance.draft.title='Unsaved local correction';
    env.state.set({world:{...structuredClone(emptyWorld),suggestions:[{...first,version:3},second]}});fixture.detectChanges();
    expect(fixture.componentInstance.draft.title).toBe('Unsaved local correction');
    await fixture.componentInstance.review('accept');
    expect(env.requests[0].expectedVersion).toBe(2); // A native conflict must never overwrite revision 3.
    fixture.componentInstance.reload();expect(fixture.componentInstance.loadedVersion()).toBe(3);
    env.params.next(convertToParamMap({id:second.id}));fixture.detectChanges();
    expect(fixture.componentInstance.id()).toBe(second.id);
    expect(fixture.componentInstance.draft.title).toBe(second.candidate.title);
    await fixture.componentInstance.review('accept');
    expect(env.requests[1]).toMatchObject({id:second.id,expectedVersion:2,record:{title:second.candidate.title}});
  });
  it('changes exact time deliberately while keeping the selected display zone', () => {
    const field=new TaskTimingField();field.load({kind:'instant',date:'',instant:1790784023.125,timeZone:'Asia/Tokyo'});
    field.zone='Europe/London';expect(field.value()?.instant).toBe(1790784023.125);
    field.time='2026-10-04T13:45';expect(field.value()).toEqual({kind:'instant',date:'',instant:new Date(field.time).getTime()/1000,timeZone:'Europe/London'});
  });
  it('retains the loaded recurrence version instead of overwriting a concurrently changed series', async () => {
    const task={...newTask(),id:'recurring-task',seriesID:'synthetic-series',version:4};
    const series={id:'synthetic-series',template:task,frequency:'daily' as const,timeZone:'UTC',startDate:'2026-10-01',localTime:'09:00',paused:false,version:2};
    const world={...structuredClone(emptyWorld),tasks:[task],series:[series]};
    const env=setup(world,task.id),fixture=TestBed.createComponent(TaskDetailComponent);fixture.detectChanges();
    fixture.componentInstance.edit();fixture.componentInstance.scope='future';fixture.detectChanges();
    env.state.set({world:{...world,series:[{...series,version:3,localTime:'11:00'}]}});fixture.detectChanges();
    fixture.componentInstance.draft.title='My retained draft';await fixture.componentInstance.save();
    expect(env.requests[0]).toMatchObject({action:'saveSeries',expectedVersion:2,record:{version:2,template:{title:'My retained draft'}}});
    env.params.next(convertToParamMap({id:'new'}));fixture.detectChanges();
    expect(fixture.componentInstance.scope).toBe('occurrence');
  });
});

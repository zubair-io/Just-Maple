import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskGroupPanelComponent, GroupReview } from './task-group-panel.component';
import { WorldService } from './world.service';
const item=(id:string,version=1)=>({id:'task:'+id,task:{id,title:'Fixture '+id,status:'open',version},reason:'',rank:0,when:0,sourceCount:1});
const review:GroupReview={id:'fixture-review',context:{intentID:'Review forms',actorID:'Me',targetID:'Forms'},maximumSpan:86400,children:[{nodeID:'task:a',expectedVersion:1},{nodeID:'task:b',expectedVersion:1}]};
function setup(){const group=vi.fn().mockResolvedValue([]),command=vi.fn().mockResolvedValue({});TestBed.configureTestingModule({providers:[{provide:WorldService,useValue:{bridge:{group,command,pending:signal(false)}}}]});const fixture=TestBed.createComponent(TaskGroupPanelComponent);fixture.componentRef.setInput('items',[item('a'),item('b')]);const c=fixture.componentInstance;c.intent='Review forms';c.actor='Me';c.target='Forms';c.days='1';c.selected.set(['task:a','task:b']);fixture.detectChanges();group.mockClear();return{fixture,c,group};}
describe('reviewed task groups',()=>{
 afterEach(()=>{TestBed.resetTestingModule();vi.useRealTimers();});
 it('requires explicit semantics and window instead of guessing from selected tasks',async()=>{const{c,group}=setup();c.days='';await c.prepare();expect(group).not.toHaveBeenCalled();expect(c.error()).toContain('positive time window');});
 it('captures exact versions and excludes arrivals after review',async()=>{const{fixture,c,group}=setup();group.mockResolvedValueOnce(review);await c.prepare();expect(group.mock.calls[0][0].children).toEqual(review.children);fixture.componentRef.setInput('items',[item('a',2),item('b'),item('new')]);group.mockResolvedValueOnce({mutationID:'done',children:review.children});await c.apply('done');expect(group.mock.calls[1][0].review.children).toEqual(review.children);expect(c.applied()?.mutationID).toBe('done');});
 it('reuses immutable mutation and timestamp after an uncertain response',async()=>{const{c,group}=setup();c.review.set(review);group.mockRejectedValueOnce(new Error('Connection interrupted'));await c.apply('done');const first=group.mock.calls[0][0];expect(c.applied()).toBeNull();group.mockResolvedValueOnce({mutationID:first.requestID,children:review.children});await c.apply('done');expect(group.mock.calls[1][0]).toEqual(first);});
 it('preserves conflict feedback and sends scoped undo target without changing membership',async()=>{const{c,group}=setup();c.review.set(review);c.applied.set({mutationID:'original',children:[]});group.mockRejectedValue(new Error('Task changed. Review again.'));await c.undo();expect(group.mock.calls[0][0].targetMutationID).toBe('original');expect(c.undone()).toBe(false);expect(c.error()).toContain('Task changed');});
 it('rejects stale selection rather than silently dropping hidden selected members',async()=>{const{fixture,c,group}=setup();fixture.componentRef.setInput('items',[item('a')]);await c.prepare();expect(group).not.toHaveBeenCalled();});
 it('polls automatic suggestions while open without changing drafts, selection or reviewed membership, then stops on destroy',async()=>{
  vi.useFakeTimers();const{fixture,c,group}=setup();c.expanded.set(true);c.editProposalDays('7');c.review.set(review);const selected=[...c.selected()];
  group.mockImplementation(async(body:any)=>body.action==='reviewedObligationGroups'?[]:{configuration:{maximumSpan:86400},status:{failed:0,running:0,completed:1,coveredVersions:2},proposals:[{id:'new',provider:'fixture',proposal:{intent:'New suggestion',actorID:'person:self',target:'Forms',reason:'Fixture',children:[]}}]});
  await vi.advanceTimersByTimeAsync(15000);
  expect(c.proposals()).toHaveLength(1);expect(c.proposalDays).toBe('7');expect(c.selected()).toEqual(selected);expect(c.review()).toEqual(review);
  const calls=group.mock.calls.length;fixture.destroy();await vi.advanceTimersByTimeAsync(30000);expect(group).toHaveBeenCalledTimes(calls);
 });
 it('uses a new successful configuration mutation when enabling the same window after pause',async()=>{
  const{c,group}=setup();c.editProposalDays('2');group.mockImplementation(async(body:any)=>body.action==='reviewedObligationGroups'?[]:body.action==='obligationGroupingSettings'?{configuration:null,status:{failed:0,running:0,completed:0,coveredVersions:0},proposals:[]}:{configured:true});
  await c.configure();await c.configure(false);await c.configure();
  const calls=group.mock.calls.map(c=>c[0]).filter(p=>p.action==='configureObligationGrouping');expect(calls).toHaveLength(3);expect(calls[0].maximumSpan).toBe(calls[2].maximumSpan);expect(calls[0].requestID).not.toBe(calls[2].requestID);
 });
 it('keeps the same configuration mutation after an uncertain failure',async()=>{
  const{c,group}=setup();c.editProposalDays('2');group.mockRejectedValueOnce(new Error('Uncertain connection'));await c.configure();const first=group.mock.calls[0][0];
  group.mockImplementation(async(body:any)=>body.action==='reviewedObligationGroups'?[]:body.action==='obligationGroupingSettings'?{configuration:null,status:{failed:0,running:0,completed:0,coveredVersions:0},proposals:[]}:{configured:true});await c.configure();expect(group.mock.calls[1][0]).toEqual(first);
 });

 it('collapses only complete current reviewed membership and retains individuals for filters or changed versions',async()=>{
  const{fixture,c}=setup();await fixture.whenStable();c.savedReviews.set([review]);const ids:string[][]=[];c.groupedIDs.subscribe(value=>ids.push(value));fixture.detectChanges();
  expect(c.visibleReviews()).toEqual([review]);expect(ids.at(-1)).toEqual(['task:a','task:b']);expect(fixture.nativeElement.textContent).toContain('2 open tasks');expect(fixture.nativeElement.querySelector('details').hasAttribute('open')).toBe(false);
  fixture.componentRef.setInput('items',[item('a')]);fixture.detectChanges();expect(c.visibleReviews()).toEqual([]);expect(ids.at(-1)).toEqual([]);
  fixture.componentRef.setInput('items',[item('a'),item('b',2)]);fixture.detectChanges();expect(c.visibleReviews()).toEqual([]);
  fixture.componentRef.setInput('items',[item('a'),item('b')]);fixture.componentRef.setInput('collapse',false);fixture.detectChanges();expect(c.visibleReviews()).toEqual([]);expect(ids.at(-1)).toEqual([]);
 });

});

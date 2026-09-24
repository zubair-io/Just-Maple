import { TestBed } from '@angular/core/testing';
import { describe,it,expect,vi } from 'vitest';
import { CompanionGroupsComponent, ReviewedGroup } from './companion-groups.component';
const group:ReviewedGroup={review:{id:'review',context:{intentID:'Review requests',actorID:'Fixture actor',targetID:'Fixture forms',connector:'gmail',account:'fixture',sourceScopeID:'thread:fixture'},maximumSpan:3600,children:[{nodeID:'task:a',expectedVersion:1},{nodeID:'task:b',expectedVersion:2}]},titles:{'task:a':'First request','task:b':'Second request'}};
describe('Companion reviewed groups',()=>{
 it('shows exact children and emits stable captured membership without later arrivals',()=>{
  const fixture=TestBed.createComponent(CompanionGroupsComponent);fixture.componentRef.setInput('groups',[group]);fixture.componentRef.setInput('available',true);fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('First request');expect(fixture.nativeElement.textContent).toContain('Second request');
  const emit=vi.spyOn(fixture.componentInstance.requested,'emit');fixture.componentInstance.send(group,'done');fixture.componentInstance.send(group,'done');
  expect(emit.mock.calls[0][0].id).toBe(emit.mock.calls[1][0].id);
  expect(emit.mock.calls[0][0].review?.children).toEqual(group.review.children);
  expect(emit.mock.calls[0][0].review).not.toBe(group.review);
  fixture.componentRef.setInput('actions',[emit.mock.calls[0][0]]);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('waiting for Mac');
  expect([...fixture.nativeElement.querySelectorAll('button')].filter((b:any)=>b.disabled)).toHaveLength(2);
 });
 it('distinguishes conflicts and only undoes an applied original group command',()=>{
  const fixture=TestBed.createComponent(CompanionGroupsComponent);fixture.componentRef.setInput('groups',[group]);fixture.componentRef.setInput('available',true);
  const action={id:'original',intent:'done',issuedAt:new Date().toISOString(),review:group.review};fixture.componentRef.setInput('actions',[action]);fixture.componentRef.setInput('receipts',[{id:'original',outcome:'conflict'}]);fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('A child changed');expect(fixture.nativeElement.textContent).not.toContain('Undo group change');
  fixture.componentRef.setInput('receipts',[{id:'original',outcome:'applied'}]);fixture.detectChanges();
  const emit=vi.spyOn(fixture.componentInstance.requested,'emit');const undo=[...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('Undo group change')) as HTMLButtonElement;undo.click();
  expect(emit.mock.calls[0][0]).toMatchObject({intent:'undo',targetMutationID:'original'});expect(emit.mock.calls[0][0].review).toBeUndefined();
 });
});

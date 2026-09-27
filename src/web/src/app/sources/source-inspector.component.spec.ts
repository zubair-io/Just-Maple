import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceInspectorComponent } from './source-inspector.component';
import { NativeBridge } from '../core/native-bridge.service';
import { TaskEvidenceComponent } from '../world/task-evidence.component';
import { WorldService } from '../world/world.service';
import { signal } from '@angular/core';
import { emptyWorld, newTask } from '../world/world.models';

describe('Read-only source inspection',()=>{
 afterEach(()=>{delete (window as any).webkit;TestBed.resetTestingModule();});
 it('shows sender, timestamp and escaped text and copies the bounded preview without a task action',async()=>{
  const source={id:'source-fixture',connector:'gmail',sender:'Fixture Sender',subject:'Fixture subject',occurredAt:'2026-09-24T10:00:00Z',content:'<script>sendReply()</script>\nPlease confirm the time.',available:true,truncated:true};
  const send=vi.fn().mockResolvedValue({copied:true});(window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
  const fixture=TestBed.createComponent(SourceInspectorComponent);fixture.componentRef.setInput('source',source);fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Fixture Sender');expect(fixture.nativeElement.textContent).toContain('shortened preview');
  expect(fixture.nativeElement.querySelector('script')).toBeNull();expect(fixture.nativeElement.querySelector('pre').textContent).toBe(source.content);
  const copy=[...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('Copy source')) as HTMLButtonElement;copy.click();await fixture.whenStable();fixture.detectChanges();
  expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0][0]).toMatchObject({action:'copySource'});expect(send.mock.calls[0][0].text).toContain('[Shortened preview]');
  expect(fixture.nativeElement.textContent).toContain('Preview copied.');
 });
 it('shows unavailable content and a copy failure instead of silently pretending success',async()=>{
  const fixture=TestBed.createComponent(SourceInspectorComponent),bridge=TestBed.inject(NativeBridge);
  fixture.componentRef.setInput('source',{id:'missing',connector:'imessage',content:'',available:false,truncated:false});fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('source is unavailable');expect(fixture.nativeElement.textContent).not.toContain('Copy source text');
  fixture.componentRef.setInput('source',{id:'present',connector:'imessage',content:'Fixture text',available:true,truncated:false});fixture.detectChanges();
  vi.spyOn(bridge,'copySource').mockRejectedValue(new Error('Clipboard unavailable'));
  await fixture.componentInstance.copy();fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Could not copy.');
 });
 it('surfaces source read failures and opening never invokes a mutation',async()=>{
  const task={...newTask(),id:'fixture',evidenceIDs:['source-fixture']};
  const inspectSource=vi.fn().mockRejectedValueOnce(new Error('read failure')).mockResolvedValueOnce({id:'source-fixture',connector:'imessage',sender:'Fixture Sender',occurredAt:1,content:'Fixture message',available:true,truncated:false});
  const act=vi.fn();
  TestBed.configureTestingModule({providers:[{provide:WorldService,useValue:{data:signal({...emptyWorld,tasks:[task]}),bridge:{inspectSource,act,pending:signal(false)}}}]});
  const fixture=TestBed.createComponent(TaskEvidenceComponent);fixture.componentRef.setInput('nodeID','task:fixture');fixture.detectChanges();
  await fixture.componentInstance.inspect('source-fixture');fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('could not be opened');
  await fixture.componentInstance.inspect('source-fixture');fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Fixture message');expect(act).not.toHaveBeenCalled();
 });
});

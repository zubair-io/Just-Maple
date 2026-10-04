import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceInspectorComponent } from './source-inspector.component';
import { NativeBridge } from '../core/native-bridge.service';
import { TaskEvidenceComponent } from '../world/task-evidence.component';
import { WorldService } from '../world/world.service';
import { signal } from '@angular/core';
import { emptyWorld, newTask } from '../world/world.models';
import { SourcesService } from './sources.service';
import { Router } from '@angular/router';

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
 it('uses the shared full Mac source drawer with retry and never invokes a task mutation',async()=>{
  const task={...newTask(),id:'fixture',evidenceIDs:['source-fixture']};
  const detail=vi.fn().mockRejectedValueOnce(new Error('Fixture read failure')).mockResolvedValueOnce({schemaVersion:1,row:{id:'source-fixture',type:'imessage',connector:'imessage',sender:'Fixture Sender',occurredAt:1,receivedAt:1,status:'complete',revision:'1'},content:'Fixture message',stages:[],artifacts:[],relatedRevisions:[],historyAvailability:'Synthetic fixture',asOf:1});
  const act=vi.fn();
  TestBed.configureTestingModule({providers:[{provide:WorldService,useValue:{data:signal({...emptyWorld,tasks:[task]}),bridge:{act,pending:signal(false)}}},
    {provide:SourcesService,useValue:{detail,history:vi.fn(async()=>({items:[]}))}}, {provide:Router,useValue:{navigate:vi.fn()}}]});
  const fixture=TestBed.createComponent(TaskEvidenceComponent);fixture.componentRef.setInput('nodeID','task:fixture');fixture.detectChanges();
  const opener=[...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('Open source')) as HTMLButtonElement;
  opener.focus();opener.click();fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
  const dialog=fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  expect(dialog.open).toBe(true);expect(dialog.textContent).toContain('Fixture read failure');
  const retry=Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent?.includes('Try again'))!;retry.click();await fixture.whenStable();fixture.detectChanges();
  expect(dialog.textContent).toContain('Fixture message');expect(dialog.textContent).toContain('Processing');expect(detail).toHaveBeenNthCalledWith(2,'source-fixture',true);
  dialog.dispatchEvent(new Event('cancel',{cancelable:true}));fixture.detectChanges();expect(document.activeElement).toBe(opener);
  expect(fixture.nativeElement.querySelector('dialog')).toBeNull();expect(act).not.toHaveBeenCalled();
 });
});

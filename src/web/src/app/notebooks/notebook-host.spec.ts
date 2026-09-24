import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { NotebookService } from './notebook.service';

describe('Notebook native transport',()=>{
 afterEach(()=>{delete (window as any).webkit;delete (window as any).mapleHost;TestBed.resetTestingModule();});
 it('routes iPhone reads, draft writes and revision-aware saves through the companion host',async()=>{
  (window as any).mapleHost='iphone';
  const desktop=vi.fn();const send=vi.fn(async(body:any)=>{
   if(body.action==='notebookCatalog')return {notebooks:[],cloudAvailable:true};
   if(body.action==='noteRead')return {notebookID:'book',path:'note.md',content:'# Original',revision:'v1'};
   if(body.action==='noteReadDraft')return null;
   if(body.action==='noteSave')return {notebookID:'book',path:'note.md',content:body.content,revision:'v2'};
   return {saved:true};
  });
  (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook:desktop}}]});
  const service=TestBed.inject(NotebookService);await service.refresh();await service.selectBook('book');await service.open('note.md');
  service.change('# My iPhone edit');expect(await service.flush()).toBe(true);
  expect(send).toHaveBeenCalledWith({action:'noteRead',id:'book',path:'note.md'});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({action:'noteDraft',record:expect.objectContaining({content:'# My iPhone edit'})}));
  expect(send).toHaveBeenCalledWith({action:'noteSave',id:'book',path:'note.md',content:'# My iPhone edit',revision:'v1'});
  expect(service.document()?.revision).toBe('v2');expect(desktop).not.toHaveBeenCalled();
 });
 it('keeps the desktop notebook bridge and never silently falls back when an iPhone host is missing',async()=>{
  const desktop=vi.fn().mockResolvedValue({notebooks:[],cloudAvailable:false});
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook:desktop}}]});
  const service=TestBed.inject(NotebookService);await service.refresh();expect(desktop).toHaveBeenCalledWith('notebookCatalog',{});
  (window as any).mapleHost='iphone';await service.refresh();
  expect(desktop).toHaveBeenCalledTimes(1);expect(service.error()).toContain('iPhone notebook storage is unavailable');
 });
});

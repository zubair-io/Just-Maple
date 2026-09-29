import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { DailyNoteService } from './daily-note.service';
import { DailyBlock, DailyNoteSnapshot, localDay, offsetDay } from './daily-note.models';
const block = (overrides: Partial<DailyBlock> = {}): DailyBlock => ({ id:'fixture-block', day:localDay(), kind:'text',content:'Original',version:1,position:0,createdAt:1,updatedAt:1,actor:'user',userEdited:false,...overrides });
const snap = (blocks: DailyBlock[] = [], day = localDay()): DailyNoteSnapshot => ({ day,timeZone:'America/New_York',blocks,cleared:[],revision:1 });
function setup() { const request=vi.fn().mockResolvedValue(snap()); TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook:request}}]});return { service:TestBed.inject(DailyNoteService), request }; }
describe('Daily note persistence boundary', () => {
  afterEach(() => { TestBed.resetTestingModule();localStorage.clear();delete (window as any).webkit;delete (window as any).mapleHost;vi.useRealTimers(); });
  it('keeps a failed edit and retries the identical mutation ID', async () => {
    const {service,request}=setup();const original=block();service.snapshot.set(snap([original]));
    service.change(original,'My edit');request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(snap([block({content:'My edit',version:2})]));
    expect(await service.saveDraft(original.id)).toBe(false);expect(service.content(original)).toBe('My edit');
    const first=request.mock.calls[0][1].record;expect(await service.saveDraft(original.id)).toBe(true);
    expect(request.mock.calls[1][1].record.requestID).toBe(first.requestID);expect(service.hasDraft(original)).toBe(false);
  });
  it('does not let polling overwrite user text or silently resolve a revision conflict', async () => {
    const {service,request}=setup();const original=block();service.snapshot.set(snap([original]));service.change(original,'User words');
    request.mockResolvedValue(snap([block({content:'Bot update',version:2,actor:'bot'})]));await service.refresh();
    expect(service.content(service.blocks()[0])).toBe('User words');expect(service.conflict(service.blocks()[0])).toBe(true);
    expect(await service.saveDraft(original.id)).toBe(false);expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(snap([block({content:'User words',version:3})]));await service.saveDraft(original.id,true);
    expect(request.mock.calls[1][1].record.expectedVersion).toBe(2);
  });
  it('ignores stale reads and opens the latest date while an old read is in flight', async () => {
    const {service,request}=setup();let finish!:(value:DailyNoteSnapshot)=>void;
    request.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const old=service.refresh();
    const tomorrow=offsetDay(localDay(),1);request.mockResolvedValueOnce(snap([],tomorrow));expect(await service.open(tomorrow)).toBe(true);
    finish(snap([block()]));await old;expect(service.snapshot()?.day).toBe(tomorrow);expect(service.loading()).toBe(false);
  });
  it('clears without completion, restores with the new version, and moves the same block ID', async () => {
    const {service,request}=setup();const original=block({kind:'task',taskNodeID:'canonical-task'});service.snapshot.set(snap([original]));
    const cleared=block({...original,version:2,clearedAt:12});request.mockResolvedValueOnce({...snap(),cleared:[cleared]});await service.action(original,'clear');
    expect(request.mock.calls[0][1].record).toMatchObject({kind:'clear',blockID:original.id,expectedVersion:1});expect(service.undoBlock()?.id).toBe(original.id);
    request.mockResolvedValueOnce(snap([block({...original,version:3})]));await service.undo();expect(request.mock.calls[1][1].record).toMatchObject({kind:'restore',expectedVersion:2});
    request.mockResolvedValueOnce(snap());await service.move(service.blocks()[0]);expect(request.mock.calls[2][1].record).toMatchObject({kind:'move',blockID:original.id,targetDay:offsetDay(localDay(),1)});
  });
  it('treats a phone queue receipt as pending rather than applied and blocks duplicate mutations', async () => {
    const {service,request}=setup();(window as any).mapleHost='iphone';const original=block();service.snapshot.set(snap([original]));
    const send=vi.fn().mockResolvedValue({...snap([original]),sync:{status:'pending',pending:['receipt'],conflicts:[],asOf:10}});(window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    expect(await service.action(original,'clear')).toBe(false);expect(service.blocks()).toHaveLength(1);expect(service.undoBlock()).toBeNull();expect(service.notice()).toContain('waiting for your Mac');
    await service.action(original,'clear');expect(send).toHaveBeenCalledTimes(1);expect(request).not.toHaveBeenCalled();
  });
  it('preserves a newer edit made while a save is in flight with the accepted version', async () => {
    const {service,request}=setup();const original=block();service.snapshot.set(snap([original]));service.change(original,'First');
    let finish!:(value:DailyNoteSnapshot)=>void;request.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const saving=service.saveDraft(original.id);await Promise.resolve();service.change(original,'Second');
    finish(snap([block({content:'First',version:2})]));await saving;expect(service.drafts()[original.id]).toMatchObject({content:'Second',version:2});
  });
  it('keeps a disappeared block draft recoverable without trapping date navigation', async () => {
    const {service,request}=setup();const original=block();service.snapshot.set(snap([original]));service.change(original,'Words worth keeping');
    request.mockResolvedValueOnce(snap());await service.refresh();expect(service.recoveredDrafts()[0].content).toBe('Words worth keeping');
    const tomorrow=offsetDay(localDay(),1);request.mockResolvedValueOnce(snap([],tomorrow));expect(await service.open(tomorrow)).toBe(true);
    expect(service.recoveredDrafts()[0].day).toBe(localDay());expect(request.mock.calls.every(call=>call[0]==='dailyNote')).toBe(true);
    request.mockResolvedValueOnce(snap([],tomorrow));expect(await service.recoverDraft(original.id)).toBe(true);
    expect(request.mock.calls.at(-1)?.[1].record).toMatchObject({kind:'create',blockKind:'text',day:tomorrow,content:'Words worth keeping'});expect(service.recoveredDrafts()).toHaveLength(0);
  });
  it('uses the current placement when explicitly keeping an edit to a moved block', async () => {
    const {service,request}=setup();const original=block();service.snapshot.set(snap([original]));service.change(original,'My edit');
    const tomorrow=offsetDay(localDay(),1);const moved=block({day:tomorrow,version:2});service.day.set(tomorrow);service.snapshot.set(snap([moved],tomorrow));
    request.mockResolvedValueOnce(snap([block({...moved,content:'My edit',version:3})],tomorrow));await service.saveDraft(original.id,true);
    expect(request.mock.calls[0][1].record).toMatchObject({day:tomorrow,expectedVersion:2,content:'My edit'});
  });
  it('keeps composer drafts attached to their day across navigation and reload', async () => {
    const {service,request}=setup();const today=localDay(),tomorrow=offsetDay(today,1);service.composer='Today thought';service.composerKind='heading';const id=service.composerID;
    request.mockResolvedValueOnce(snap([],tomorrow));await service.open(tomorrow);expect(service.composer).toBe('');service.composer='Tomorrow thought';
    request.mockResolvedValueOnce(snap([],today));await service.open(today);expect(service.composer).toBe('Today thought');expect(service.composerKind).toBe('heading');expect(service.composerID).toBe(id);
    TestBed.resetTestingModule();const fresh=setup().service;expect(fresh.composer).toBe('Today thought');expect(fresh.composerID).toBe(id);
  });
  it('does not mistake a rejected phone receipt for a successful edit', async () => {
    const {service}=setup();(window as any).mapleHost='iphone';const original=block();service.snapshot.set(snap([original]));service.change(original,'Offline edit');
    const send=vi.fn(async(body:any)=>({...snap([original]),sync:{status:'conflict',pending:[],conflicts:[body.record.requestID],asOf:10}}));(window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    expect(await service.saveDraft(original.id)).toBe(false);expect(service.content(original)).toBe('Offline edit');expect(service.error()).toContain('could not apply');
  });
  it('settles a queued create when its stable ID returns, preserving later composer writing', async () => {
    const {service,request}=setup();service.composer='Queued writing';const createdID=service.composerID;
    request.mockResolvedValueOnce({...snap(),sync:{status:'pending',pending:['request'],conflicts:[],asOf:1}});
    expect(await service.create('text',service.composer,createdID)).toBe(false);
    service.composer='New writing after the queue';request.mockResolvedValueOnce(snap([block({id:createdID,content:'Queued writing'})]));await service.refresh();
    expect(service.composer).toBe('New writing after the queue');expect(service.composerID).not.toBe(createdID);
    const nextID=service.composerID;request.mockResolvedValueOnce(snap([block({id:nextID,content:service.composer})]));await service.refresh();expect(service.composer).toBe('');expect(service.composerID).not.toBe(nextID);
  });
  it('uses calendar dates across daylight saving boundaries',()=>{expect(offsetDay('2026-03-08',1)).toBe('2026-03-09');expect(offsetDay('2026-11-01',-1)).toBe('2026-10-31');});
});

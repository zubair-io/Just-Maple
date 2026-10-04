import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceDetailComponent } from './source-detail.component';
import { SourcesService } from './sources.service';

let fixture: ComponentFixture<SourceDetailComponent> | undefined;
let opener: HTMLButtonElement;
const detail = (id = 'fixture-source') => ({ schemaVersion: 1, row: { id, subject: 'Synthetic source', type: 'email', connector: 'fixture', revision: '1', occurredAt: 1, receivedAt: 1, status: 'complete' }, content: 'Synthetic source content', stages: [], artifacts: [], relatedRevisions: [], historyAvailability: 'Synthetic fixture', asOf: 1 });
function setup() {
  const service = { detail: vi.fn(async (id: string) => detail(id)), history: vi.fn(async (): Promise<any> => ({ items: [], nextSequence: undefined })), artifact: vi.fn(), retry: vi.fn() };
  const router = { navigate: vi.fn(async () => true) };
  TestBed.configureTestingModule({ providers: [{ provide: SourcesService, useValue: service }, { provide: Router, useValue: router }] });
  opener = document.createElement('button'); opener.textContent = 'Synthetic opener'; document.body.append(opener); opener.focus();
  fixture = TestBed.createComponent(SourceDetailComponent);
  fixture.componentRef.setInput('eventID', 'fixture-source'); fixture.detectChanges();
  return { service, router, component: fixture.componentInstance };
}
afterEach(() => { fixture?.destroy(); fixture = undefined; opener?.remove(); TestBed.resetTestingModule(); });

describe('Shared source drawer keyboard and async lifecycle', () => {
  it('opens once, labels modal content and restores the connected opener without scrolling', async () => {
    const { component } = setup(); await fixture!.whenStable(); fixture!.detectChanges();
    const dialog = fixture!.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true); expect(dialog.getAttribute('aria-label')).toBe('Source details');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focus = vi.spyOn(opener, 'focus'); const close = vi.fn(); component.closed.subscribe(close);
    component.close();
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(opener);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true }); expect(close).toHaveBeenCalledOnce();
  });
  it('Escape cancels the modal; refreshing data does not forcibly focus Close again', async () => {
    const { component } = setup(); await fixture!.whenStable(); fixture!.detectChanges();
    const processing = [...fixture!.nativeElement.querySelectorAll('.tabs button')].find((b: any) => b.textContent.trim() === 'Processing') as HTMLButtonElement;
    processing.focus(); await component.load(); fixture!.detectChanges();
    expect(document.activeElement).not.toBe(fixture!.nativeElement.querySelector('header button'));
    const closed = vi.fn(); component.closed.subscribe(closed);
    fixture!.nativeElement.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(closed).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(opener);
  });
  it('keeps the drawer open after blocked navigation and reports rejected navigation', async () => {
    const { router, component } = setup(); await fixture!.whenStable();
    router.navigate.mockResolvedValueOnce(false); await component.openBacklink({ documentID: 'doc', day: '2026-09-30' });
    expect(component.actionStatus()).toContain('Resolve its save error');
    expect(fixture!.nativeElement.querySelector('dialog').open).toBe(true);
    router.navigate.mockRejectedValueOnce(Error('synthetic failure')); await component.openRelated('other');
    expect(component.actionStatus()).toContain('Could not open');
  });
  it('does not steal focus back from successful navigation during destruction', async () => {
    const { router, component } = setup(); await fixture!.whenStable();
    let complete!: (value: boolean) => void;
    router.navigate.mockImplementationOnce(() => new Promise(resolve => complete = resolve));
    const navigation = component.openRelated('other'); const focus = vi.spyOn(opener, 'focus');
    fixture!.destroy(); fixture = undefined; complete(true); await navigation;
    expect(focus).not.toHaveBeenCalledWith({ preventScroll: true });
  });
  it('ignores obsolete retry results and history failures after another source is selected', async () => {
    const { service, component } = setup(); await fixture!.whenStable();
    let reply!: (value: any) => void; service.retry.mockImplementationOnce(() => new Promise(resolve => reply = resolve));
    const retry = component.retry({ stage: 'classification', version: 1 } as any);
    fixture!.componentRef.setInput('eventID', 'new-source'); fixture!.detectChanges(); await fixture!.whenStable();
    reply({ status: 'old result' }); await retry;
    expect(component.detail()?.row.id).toBe('new-source'); expect(component.actionStatus()).not.toContain('old result');
    let fail!: (error: unknown) => void; service.history.mockImplementationOnce(() => new Promise((_, reject) => fail = reject));
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    component.nextHistory.set(100);
    const history = component.moreHistory();
    fixture!.componentRef.setInput('eventID', 'third-source'); fixture!.detectChanges();
    fail(Error('old failure')); await history; await fixture!.whenStable();
    expect(component.actionStatus()).not.toContain('Earlier history could not');
  });
  it('shows retained attempt timing and explicitly marks missing historical coverage', async () => {
    const { component } = setup(); await fixture!.whenStable();
    component.detail.set({ ...detail(), historyAvailability: 'legacy_latest_only_before_audit', attempts: [
      { id:'complete',stage:'classification',startedAt:100,endedAt:101.25,transportOutcome:'succeeded',commitOutcome:'applied' },
      { id:'unfinished',stage:'tasks',startedAt:102,transportOutcome:'unknown',commitOutcome:'pending' },
    ] } as any);
    component.tab.set('History'); fixture!.detectChanges();
    const text = fixture!.nativeElement.textContent;
    expect(text).toContain('Duration 1.3 s'); expect(text).toContain('End time not recorded');
    expect(text).toContain('Duration unavailable'); expect(text).toContain('Historical attempt detail was not recorded');
    expect(component.attemptDuration(5,4)).toBe('Duration unavailable');
    expect(component.attemptDuration('invalid','invalid')).toBe('Duration unavailable');
    expect(component.attemptDuration(0,0.025)).toBe('Duration 25 ms');
    expect(component.attemptDuration(0,121)).toBe('Duration 2 min 1 s');
    expect(component.attemptDuration('2026-09-30T00:00:00.000Z','2026-09-30T00:00:00.050Z')).toBe('Duration 50 ms');
  });
  it('shows bounded conversation evidence as escaped text and opens the exact message', async () => {
    const {component,router}=setup();await fixture!.whenStable();
    component.detail.set({...detail(),conversation:{threadID:'thread:fixture',connector:'gmail',account:'synthetic',asOf:1,totalMessages:60,omittedMessages:10,messages:[
      {eventID:'exact-original',occurredAt:1,receivedAt:2,sender:'<img src=x>',direction:'outgoing',content:'<script>synthetic()</script>',truncated:true,selected:true,historicalRevision:true},
      {eventID:'exact-reply',occurredAt:3,receivedAt:4,content:'Synthetic reply',truncated:false,selected:false,historicalRevision:false},
    ]}} as any);
    component.tab.set('Conversation');fixture!.detectChanges();
    const text=fixture!.nativeElement.textContent;
    expect(text).toContain('60 messages');expect(text).toContain('10 earlier messages omitted');
    expect(text).toContain('original historical revision');expect(text).toContain('Excerpt shortened');expect(text).toContain('Direction not recorded');
    expect(text).toContain('<script>synthetic()</script>');expect(fixture!.nativeElement.querySelector('script,img')).toBeNull();
    const buttons=Array.from(fixture!.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(b=>b.textContent?.trim()==='Open this message');
    buttons[1].click();await fixture!.whenStable();expect(router.navigate).toHaveBeenCalledWith(['/sources','exact-reply'],{queryParamsHandling:'preserve'});
  });
  it('serializes history pages and retains the cursor and existing entries on failure', async () => {
    const { component, service } = setup(); await fixture!.whenStable();
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    component.nextHistory.set(100); component.history.set([{ sequence: 101 } as any]);
    let fail!: (error: unknown) => void;
    service.history.mockImplementationOnce(() => new Promise((_, reject) => fail = reject));
    const pending = component.moreHistory(); await component.moreHistory();
    expect(service.history).toHaveBeenCalledTimes(2); expect(component.historyLoading()).toBe(true);
    fail(Error('Synthetic read unavailable')); await pending;
    expect(component.nextHistory()).toBe(100); expect(component.history()).toEqual([{ sequence: 101 }]);
    expect(component.historyLoading()).toBe(false); expect(component.actionStatus()).toContain('Try Earlier history again');
    service.history.mockResolvedValueOnce({ items: [{ sequence: 99 }], nextSequence: 98 });
    await component.moreHistory();
    expect(component.history().map(item => item.sequence)).toEqual([101,99]);
    expect(component.nextHistory()).toBe(98); expect(component.actionStatus()).toBe('');
  });

});

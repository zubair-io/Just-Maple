import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionTodayComponent, CompanionTodayService } from './companion-today.component';

describe('phone canonical daily document',()=>{
  afterEach(()=>{delete (window as any).webkit;vi.restoreAllMocks();TestBed.resetTestingModule();});
  const note=(day:string,content='Mac writing')=>({day,path:day.slice(0,4)+'/'+day.slice(5,7)+'/'+day+'.md',content,revision:content,readOnly:true});
  function host(send:any){(window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};return TestBed.inject(CompanionTodayService);}
  it('reads the Markdown file rather than a legacy daily snapshot',async()=>{
    const send=vi.fn().mockResolvedValue(note('2026-09-29'));
    const service=host(send);await service.open('2026-09-29');
    expect(send).toHaveBeenCalledWith({action:'todayRead',day:'2026-09-29'});
    expect(service.document()?.content).toBe('Mac writing');
    send.mockResolvedValue(note('2026-09-29','Mac updated the note'));
    await service.open();expect(service.document()?.content).toBe('Mac updated the note');
  });
  it('ignores late reads after a different day opens',async()=>{
    let finish!:(value:unknown)=>void;
    const send=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>finish=resolve)).mockResolvedValue(note('2026-09-30'));
    const service=host(send);const first=service.open('2026-09-29');await service.open('2026-09-30');
    finish(note('2026-09-29'));await first;
    expect(service.day()).toBe('2026-09-30');expect(service.document()?.day).toBe('2026-09-30');
  });
  it('shows missing-cloud errors instead of an empty competing document',async()=>{
    const send=vi.fn().mockResolvedValueOnce(note('2026-09-29')).mockRejectedValue(new Error('Waiting for iCloud'));
    const service=host(send);await service.open('2026-09-29');await service.open('2026-09-30');
    expect(service.document()).toBeNull();expect(service.error()).toBe('Waiting for iCloud');
  });
  it('keeps the selected day pinned across midnight until Today is selected again',async()=>{
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026,8,29,23,59));
      const send=vi.fn(async(body:any)=>note(body.day));const service=host(send);
      await service.openToday();vi.setSystemTime(new Date(2026,8,30,0,1));await service.open();
      expect(service.document()?.day).toBe('2026-09-29');await service.openToday();
      expect(service.document()?.day).toBe('2026-09-30');
    } finally {vi.useRealTimers();}
  });
  it('timestamps only successful local reads and retains stale content across refresh failures',async()=>{
    let now=Date.parse('2026-09-29T12:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now);
    const send=vi.fn().mockResolvedValueOnce(note('2026-09-29')).mockRejectedValueOnce(new Error('Waiting for iCloud'));
    const service=host(send);await service.open('2026-09-29');
    const first=service.checkedAt();expect(first).toBe(now);expect(service.showingCached()).toBe(false);
    now+=60000;await service.open();
    expect(service.document()?.content).toBe('Mac writing');expect(service.checkedAt()).toBe(first);expect(service.showingCached()).toBe(true);
    let finish!:(value:unknown)=>void;send.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const retry=service.open();expect(service.showingCached()).toBe(true);expect(service.checkedAt()).toBe(first);
    now+=60000;finish(note('2026-09-29','Latest locally available writing'));await retry;
    expect(service.checkedAt()).toBe(now);expect(service.showingCached()).toBe(false);expect(service.error()).toBe('');
  });
  it('does not carry file freshness into another day or accept a stale read timestamp',async()=>{
    let now=Date.parse('2026-09-29T12:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now);
    const send=vi.fn().mockResolvedValueOnce(note('2026-09-29'));const service=host(send);await service.open('2026-09-29');
    let finish!:(value:unknown)=>void;send.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const oldRead=service.open();send.mockRejectedValueOnce(new Error('Not downloaded'));now+=60000;
    await service.open('2026-09-30');expect(service.document()).toBeNull();expect(service.checkedAt()).toBeNull();expect(service.showingCached()).toBe(false);
    finish(note('2026-09-29'));await oldRead;expect(service.checkedAt()).toBeNull();
    send.mockResolvedValueOnce(note('2026-09-30'));await service.open();expect(service.checkedAt()).toBe(now);
  });
  it('does not renew freshness for malformed responses or cancelled reads',async()=>{
    let now=Date.parse('2026-09-29T12:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now);
    const send=vi.fn().mockResolvedValueOnce(note('2026-09-29'));const service=host(send);await service.open('2026-09-29');const first=service.checkedAt();
    now+=60000;send.mockResolvedValueOnce({...note('2026-09-29'),revision:''});await service.open();
    expect(service.checkedAt()).toBe(first);expect(service.showingCached()).toBe(true);
    let finish!:(value:unknown)=>void;send.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const request=service.open();service.cancel();
    finish(note('2026-09-29','Unobserved newer file'));await request;
    expect(service.checkedAt()).toBe(first);expect(service.document()?.content).toBe('Mac writing');
  });
  it('renders stale file check time and keeps readonly writing after a failed refresh',async()=>{
    const send=vi.fn(async(body:any)=>note(body.day));host(send);
    const fixture=TestBed.createComponent(CompanionTodayComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const before=fixture.nativeElement.querySelector('.file-freshness time').getAttribute('datetime');
    expect(fixture.nativeElement.textContent).toContain('Daily file checked on this iPhone');
    send.mockRejectedValue(new Error('iCloud file unavailable'));await fixture.componentInstance.notes.open();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.file-freshness time').getAttribute('datetime')).toBe(before);
    expect(fixture.nativeElement.textContent).toContain('Showing the last successfully read copy');
    expect(fixture.nativeElement.textContent).toContain('Mac writing');
    expect(fixture.nativeElement.querySelector('.tiptap').getAttribute('contenteditable')).toBe('false');
    fixture.destroy();
  });

});

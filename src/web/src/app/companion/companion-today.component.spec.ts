import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionTodayService } from './companion-today.component';

describe('phone canonical daily document',()=>{
  afterEach(()=>{delete (window as any).webkit;TestBed.resetTestingModule();});
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
});

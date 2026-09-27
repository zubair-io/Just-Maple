import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyNoteComponent } from './daily-note.component';
import { NativeBridge } from '../core/native-bridge.service';
import { localDay } from './daily-note.models';
describe('Living daily note',()=>{
 afterEach(()=>{TestBed.resetTestingModule();localStorage.clear();});
 it('shows a truthful empty day and creates any selected block kind with real commands',async()=>{
  const snapshot={day:localDay(),timeZone:'UTC',blocks:[],cleared:[],revision:1};const notebook=vi.fn().mockResolvedValue(snapshot);
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook}}]});const fixture=TestBed.createComponent(DailyNoteComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('A little breathing room.');expect(fixture.nativeElement.textContent).not.toContain('Maya');
  fixture.componentInstance.composerKind='code';fixture.componentInstance.composer='const answer = 42;';await fixture.componentInstance.add();
  expect(notebook.mock.calls.at(-1)).toMatchObject(['dailyBlockMutate',{record:{kind:'create',blockKind:'code',content:'const answer = 42;'}}]);expect(fixture.componentInstance.composer).toBe('');
 });
 it('does not show an empty day when storage is unavailable',async()=>{
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook:vi.fn().mockRejectedValue(new Error('This date has not synced yet.'))}}]});const fixture=TestBed.createComponent(DailyNoteComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('This date has not synced yet.');expect(fixture.nativeElement.textContent).not.toContain('A little breathing room.');
 });
});

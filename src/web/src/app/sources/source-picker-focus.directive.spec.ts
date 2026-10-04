import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { SourcePickerFocusDirective } from './source-picker-focus.directive';
@Component({ standalone: true, imports: [SourcePickerFocusDirective], template: `
<button class="opener" (click)="open.set(true)">Add source</button>
@if (open()) {<dialog mapleSourcePicker (pickerClosed)="open.set(false)" aria-label="Synthetic picker">
<button (click)="open.set(false)">Close</button><input type="search" aria-label="Search sources" />
<button class="result">{{ result() }}</button></dialog>}` })
class Host { open = signal(false); result = signal('Fixture source'); }
afterEach(() => TestBed.resetTestingModule());
it('focuses search on explicit opening, keeps focus during search updates, and restores opener on Escape', async () => {
  const fixture = TestBed.createComponent(Host); fixture.detectChanges();
  const opener = fixture.nativeElement.querySelector('.opener') as HTMLButtonElement;
  opener.focus(); opener.click(); fixture.detectChanges(); await fixture.whenStable();
  const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  const search = dialog.querySelector('input')!;
  expect(dialog.open).toBe(true); expect(document.activeElement).toBe(search);
  const result = dialog.querySelector('.result') as HTMLButtonElement;
  result.focus(); fixture.componentInstance.result.set('Updated fixture'); fixture.detectChanges();
  expect(document.activeElement).toBe(result);
  const focus = vi.spyOn(opener, 'focus'); dialog.dispatchEvent(new Event('cancel', { cancelable: true })); fixture.detectChanges(); await Promise.resolve();
  expect(fixture.nativeElement.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true }); fixture.destroy();
});
it('does not open a picker that was removed before its focus microtask', async () => {
  const fixture = TestBed.createComponent(Host); fixture.detectChanges();
  fixture.componentInstance.open.set(true); fixture.detectChanges();
  const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  fixture.componentInstance.open.set(false); fixture.detectChanges(); await fixture.whenStable();
  expect(dialog.open).toBe(false); expect(dialog.isConnected).toBe(false); fixture.destroy();
});

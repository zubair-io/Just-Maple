import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { MapleEditorComponent } from '../editor/maple-editor.component';
import { TodayDocument, TodayDocumentService } from './today-document.service';

// Use the real shared editor: a stub misses Tiptap's editable-state update events.
@Component({ standalone: true, imports: [MapleEditorComponent], template: `
  @if (notes.document(); as doc) {
    @for (generation of [notes.generation()]; track generation) {
      <maple-editor [initial]="notes.initial()" [documentID]="doc.documentID"
        [readOnly]="doc.readOnly || notes.actionBusy() || notes.loading()"
        (changed)="notes.change($event)" />
    }
  }
` })
class OpeningHarness { readonly notes = inject(TodayDocumentService); }

const original: TodayDocument = {
  schemaVersion: 1, documentID: 'fixture-old', notebookID: 'fixture-book',
  path: '2026/10/2026-10-02.md', day: '2026-10-02', timeZone: 'America/New_York',
  content: '<!-- maple:block {"v":1,"id":"original"} -->\nKeep my writing.\n',
  revision: 'r1', readOnly: false, indexingPending: false, legacyMigrationAvailable: false,
  capabilities: { taskActions: true, sourceReferences: true },
};
afterEach(() => TestBed.resetTestingModule());

describe('Opening with the real shared note editor', () => {
  it.each(['same', 'next'])('does not invent writing or saves when opening the %s note', async target => {
    let finish!: (doc: TodayDocument) => void;
    let reads = 0;
    const request = vi.fn(async (action: string) => {
      if (action === 'todayOpen') return ++reads === 1 ? original : new Promise<TodayDocument>(resolve => finish = resolve);
      return [];
    });
    TestBed.configureTestingModule({ providers: [{ provide: NativeBridge, useValue: { notebook: request } }] });
    const fixture = TestBed.createComponent(OpeningHarness), notes = fixture.componentInstance.notes;
    await notes.open(original.day);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const editor = fixture.debugElement.query(By.directive(MapleEditorComponent)).componentInstance as MapleEditorComponent;
    const changed = vi.fn(); editor.changed.subscribe(changed);
    const before = notes.state().editVersion;
    for (const busy of [true, false]) {
      notes.actionBusy.set(busy); fixture.detectChanges();
      expect(editor.editor!.isEditable).toBe(!busy);
      expect(changed).not.toHaveBeenCalled();
      expect(notes.content()).toBe(original.content);
      expect(notes.state().editVersion).toBe(before);
    }
    const next = target === 'same' ? original : { ...original, documentID: 'fixture-next', day: '2026-10-03', content: 'Next note\n' };
    const opening = notes.open(next.day);
    fixture.detectChanges();
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(editor.editor!.isEditable).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(notes.dirty()).toBe(false);
    expect(notes.state().editVersion).toBe(before);
    finish(next);
    expect(await opening).toBe(true);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(notes.openError()).toBe('');
    expect(notes.document()?.documentID).toBe(next.documentID);
    expect(notes.content()).toBe(next.content);
    expect(notes.dirty()).toBe(false);
    expect(request.mock.calls.some(([action]) => ['documentDraft', 'documentCommit'].includes(action))).toBe(false);
    const active = fixture.debugElement.query(By.directive(MapleEditorComponent)).componentInstance as MapleEditorComponent;
    expect(active.editor!.isEditable).toBe(true);
    // Locking did not disable legitimate editing or its durable draft path.
    active.editor!.commands.insertContent('Actual writing ');
    expect(notes.dirty()).toBe(true);
    expect(notes.content()).toContain('Actual writing');
    fixture.destroy();
    // Dispose this fixture's debounce without fabricating a commit acknowledgement.
    await notes.flush();
  });
});

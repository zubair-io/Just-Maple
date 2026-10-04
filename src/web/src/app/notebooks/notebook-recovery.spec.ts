import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { NotebookService } from './notebook.service';
import { NotebooksComponent } from './notebooks.component';

const book = { id: 'book', name: 'Fixture', location: 'Fixture', cloud: false, available: true, notes: [] };
const original = { notebookID: 'book', path: 'Original.md', revision: 'v1', content: 'Original writing' };

async function setup(managed = false, respond?: (action: string, data: any) => Promise<any>) {
  const doc = { ...original, ...(managed ? { documentID: 'managed-note', readOnly: false, day: '', blocks: [], cleared: [] } : {}) };
  const notebook = vi.fn(async (action: string, data: any) => {
    if (action === 'notebookCatalog') return { notebooks: [book], cloudAvailable: false };
    if (action === 'documentOpen') return { ...doc };
    if (action === 'mapleRuns') return [];
    if (respond) return respond(action, data);
    return { saved: true };
  });
  TestBed.configureTestingModule({ providers: [{ provide: NativeBridge, useValue: { notebook } }] });
  const notes = TestBed.inject(NotebookService);
  notes.catalog.set({ notebooks: [book], cloudAvailable: false });
  notes.bookID.set('book'); notes.load(doc);
  const fixture = TestBed.createComponent(NotebooksComponent);
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  if (managed) await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.editor).toBeDefined();
  });
  return { fixture, component: fixture.componentInstance, notes, notebook };
}

function button(fixture: any, label: string): HTMLButtonElement {
  const found = [...fixture.nativeElement.querySelectorAll('button')].find((node: any) => node.textContent.trim() === label);
  expect(found, label).toBeTruthy();
  return found as HTMLButtonElement;
}
afterEach(() => TestBed.resetTestingModule());

describe('Notebook recovery without leaving the current writing', () => {
  it('opens the shared source picker as a modal and restores writing focus on Escape', async () => {
    const { fixture, component } = await setup();
    const writing = component.editor!.editor!.view.dom;
    writing.focus();
    component.picker.set(true); fixture.detectChanges(); await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog.notebook-source-picker') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('input[type="search"]'));
    const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel);
    fixture.detectChanges();
    expect(cancel.defaultPrevented).toBe(true); expect(component.picker()).toBe(false);
    await Promise.resolve();
    expect(document.activeElement).toBe(writing);
    fixture.destroy();
  });

  it('names a notebook in a modal and returns to unchanged writing on Escape', async () => {
    const { fixture, component, notes, notebook } = await setup();
    const writing = component.editor!.editor!.view.dom, content = notes.document()!.content;
    writing.focus(); component.show('book'); fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog.notebook-name') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); fixture.detectChanges(); await Promise.resolve();
    expect(component.dialog).toBe(''); expect(document.activeElement).toBe(writing);
    expect(notes.document()!.content).toBe(content);
    expect(notebook.mock.calls.some(([action]) => action === 'notebookCreate' || action === 'noteCreate')).toBe(false);
    fixture.destroy();
  });

  it.each(['conflict', 'draft'])('rescues a copy after %s failure without saving or replacing the original', async failure => {
    const { fixture, component, notes, notebook } = await setup(false, async (action, data) => {
      if (action === 'noteDraft' && failure === 'draft') throw Error('Fixture draft unavailable');
      if (action === 'noteCreate') return { ...original, path: 'Rescue.md', revision: 'empty' };
      if (action === 'noteSave') {
        if (data.path === original.path) throw Error('Fixture external edit conflict');
        return { ...original, path: data.path, revision: 'copy1', content: data.content };
      }
      return { saved: true };
    });
    notes.change('Unsaved fixture writing');
    expect(await notes.flush()).toBe(false);
    const generation = notes.generation(), editor = component.editor;
    const originalSaveCount = notebook.mock.calls.filter(([action, data]) => action === 'noteSave' && data.path === original.path).length;
    fixture.detectChanges(); button(fixture, 'Save a copy').click();
    component.name = 'Rescue'; await component.submit(); fixture.detectChanges();
    expect(component.dialog).toBe('');
    expect(notebook).toHaveBeenCalledWith('noteSave', expect.objectContaining({ path: 'Rescue.md', content: 'Unsaved fixture writing' }));
    expect(notebook.mock.calls.filter(([action, data]) => action === 'noteSave' && data.path === original.path)).toHaveLength(originalSaveCount);
    expect(notes.document()).toEqual({ ...original, content: 'Unsaved fixture writing' });
    expect(notes.dirty()).toBe(true); expect(notes.generation()).toBe(generation);
    expect(component.editor).toBe(editor);
    expect(fixture.nativeElement.textContent).toContain('Copy saved: Rescue.md');
    fixture.destroy();
  });

  it.each([false, true])('preserves newer typing and the current document when copy failure is %s', async fail => {
    let finish!: () => void;
    const { fixture, component, notes, notebook } = await setup(false, async (action, data) => {
      if (action === 'noteCreate') return { ...original, path: 'Rescue.md', revision: 'empty' };
      if (action === 'noteSave') {
        await new Promise<void>(resolve => finish = resolve);
        if (fail) throw Error('Fixture copy unavailable');
        return { ...original, path: data.path, revision: 'copy1', content: data.content };
      }
      return { saved: true };
    });
    notes.change('Copy snapshot'); component.show('copy'); component.name = 'Rescue';
    const saving = component.submit();
    await vi.waitFor(() => expect(finish).toBeDefined());
    notes.change('New writing during copy'); finish(); await saving;
    expect(notebook).toHaveBeenCalledWith('noteSave', expect.objectContaining({ path: 'Rescue.md', content: 'Copy snapshot' }));
    expect(notes.document()).toEqual({ ...original, content: 'New writing during copy' });
    expect(notes.dirty()).toBe(true);
    expect(component.dialog).toBe(fail ? 'copy' : '');
    expect(notes.status()).toContain(fail ? 'copy needs attention' : 'newer edits remain');
    // Drain the pending debounce through a known failure without discarding text.
    notebook.mockImplementation(async (action: string) => { if (action === 'noteSave') throw Error('Fixture original remains conflicted'); return { saved: true }; });
    expect(await notes.flush()).toBe(false);
    fixture.destroy();
  });

  it('exposes managed save retry, safe reopen, and recovery copy using the existing session', async () => {
    const { fixture, component, notebook } = await setup(true, async (action, data) => {
      if (action === 'documentCommit') throw Error('Fixture managed conflict');
      if (action === 'documentRecoveryCopy') return { path: 'Recovered.md' };
      return { saved: true };
    });
    const managed = component.managed;
    managed.change('Unsaved managed writing'); expect(await managed.flush()).toBe(false);
    const editor = component.editor, generation = managed.generation();
    const retry = vi.spyOn(managed, 'flush').mockResolvedValue(false);
    const reopen = vi.spyOn(managed, 'reopen').mockResolvedValue();
    fixture.detectChanges();
    button(fixture, 'Retry save').click(); expect(retry).toHaveBeenCalledOnce();
    button(fixture, 'Reopen current file · retain draft').click(); expect(reopen).toHaveBeenCalledOnce();
    button(fixture, 'Save recovery copy').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(notebook).toHaveBeenCalledWith('documentRecoveryCopy', { documentID: 'managed-note', content: 'Unsaved managed writing' });
    expect(managed.content()).toBe('Unsaved managed writing'); expect(managed.dirty()).toBe(true);
    expect(managed.generation()).toBe(generation); expect(component.editor).toBe(editor);
    expect(fixture.nativeElement.textContent).toContain('Recovery copy saved: Recovered.md');
    fixture.destroy();
  });

  it('copies latest managed writing from document tools without raw notebook writes or a save', async () => {
    const { fixture, component, notes, notebook } = await setup(true, async action => {
      if (action === 'documentRecoveryCopy') return { path: 'Recovered.md' };
      return { saved: true };
    });
    const editor = component.editor!, managed = component.managed;
    editor.editor!.commands.insertContent('Latest managed writing. ');
    const content = managed.content(), generation = managed.generation();
    expect(content).toContain('Latest managed writing.');
    expect(notes.document()?.content).not.toBe(content);
    fixture.nativeElement.querySelector('.note-tools-toggle').click(); fixture.detectChanges();
    button(fixture, 'Save recovery copy').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.dialog).toBe('');
    expect(notebook).toHaveBeenCalledWith('documentRecoveryCopy', { documentID: 'managed-note', content });
    expect(notebook.mock.calls.filter(([action]) => ['noteCreate', 'noteSave', 'documentCommit'].includes(action))).toHaveLength(0);
    expect(managed.content()).toBe(content); expect(managed.dirty()).toBe(true);
    expect(component.editor).toBe(editor); expect(managed.generation()).toBe(generation);
    // A stale name dialog must also respect the current managed authority.
    component.dialog = 'copy'; component.name = '';
    await component.submit();
    expect(notebook.mock.calls.filter(([action]) => action === 'documentRecoveryCopy')).toHaveLength(2);
    expect(notebook.mock.calls.filter(([action]) => ['noteCreate', 'noteSave', 'documentCommit'].includes(action))).toHaveLength(0);
    fixture.destroy();
  });

  it('offers retry, cancellation, retained response insertion, and earlier requests for managed notebooks', async () => {
    const { fixture, component } = await setup(true);
    const managed = component.managed;
    const retry = vi.spyOn(managed, 'retryRun').mockResolvedValue();
    const cancel = vi.spyOn(managed, 'cancelRun').mockResolvedValue();
    const insert = vi.spyOn(managed, 'insertReply').mockResolvedValue();
    const select = vi.spyOn(managed, 'selectRun').mockResolvedValue();
    const base = { runID: 'fixture-run', requestBlockID: 'fixture-block', request: { text: 'Fixture request' }, eventIDs: [], text: '', error: '', coverage: '' };
    for (const status of ['failed', 'canceled', 'configuration_required']) {
      managed.run.set({ ...base, status } as any); fixture.detectChanges();
      button(fixture, 'Retry request').click();
    }
    expect(retry).toHaveBeenCalledTimes(3);
    for (const status of ['queued', 'running']) {
      managed.run.set({ ...base, status } as any); fixture.detectChanges();
      button(fixture, 'Cancel request').click();
    }
    expect(cancel).toHaveBeenCalledTimes(2);
    managed.run.set({ ...base, status: 'unapplied', text: 'Retained fixture response' } as any);
    fixture.detectChanges(); button(fixture, 'Retry anchored insertion').click();
    expect(insert).toHaveBeenCalledOnce(); expect(fixture.nativeElement.textContent).toContain('not inserted over your writing');
    const earlier = { ...base, runID: 'earlier', requestBlockID: 'earlier-block', status: 'failed' } as any;
    managed.runs.set([managed.run()!, earlier]); fixture.detectChanges();
    button(fixture, 'failed · earlier-block').click(); expect(select).toHaveBeenCalledWith(earlier);
    fixture.destroy();
  });
});

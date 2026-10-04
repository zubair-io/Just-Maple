import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { NotebookService, NoteDocument } from './notebook.service';

const original: NoteDocument = { notebookID: 'book', path: 'original.md', revision: 'r1', content: 'Original writing' };
function setup(handler: (action: string, data: any) => Promise<any>) {
  const notebook = vi.fn(handler);
  TestBed.configureTestingModule({ providers: [{ provide: NativeBridge, useValue: { notebook } }] });
  const service = TestBed.inject(NotebookService);
  service.bookID.set('book');
  service.load(original);
  return { service, notebook };
}
afterEach(() => {
  TestBed.resetTestingModule();
  delete (window as any).mapleHost;
  delete (window as any).webkit;
});

describe('Notebook local draft coordination', () => {
  it('retains writing that arrives while a different note is opening, even if it saves before the read returns', async () => {
    let finish!: (value: NoteDocument) => void;
    const { service } = setup(async (action, data) => {
      if (action === 'noteRead') return new Promise(resolve => finish = resolve);
      if (action === 'noteReadDraft') return null;
      if (action === 'noteSave') return { ...original, content: data.content, revision: 'r2' };
      return {};
    });
    const opening = service.open('next.md');
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change('Typing arrived after navigation began');
    expect(await service.flush()).toBe(true);
    finish({ ...original, path: 'next.md', content: 'A different note' });
    await opening;
    expect(service.document()).toMatchObject({ path: 'original.md', content: 'Typing arrived after navigation began', revision: 'r2' });
    expect(service.initial()).toBe(original.content);
    expect(service.error()).toContain('Opening paused');
    expect(service.loading()).toBe(false);
  });

  it('never commits or claims success while the newest draft cannot be written, and retries when storage recovers', async () => {
    let writable = false;
    const drafts: NoteDocument[] = [];
    const { service, notebook } = setup(async (action, data) => {
      if (action === 'noteDraft') {
        drafts.push(data.record);
        if (!writable) throw Error('Draft volume unavailable');
      }
      if (action === 'noteSave') return { ...original, content: data.content, revision: 'r2' };
      return {};
    });
    service.change('Writing must stay recoverable');
    expect(await service.flush()).toBe(false);
    expect(notebook.mock.calls.filter(([action]) => action === 'noteSave')).toHaveLength(0);
    expect(service.dirty()).toBe(true);
    expect(service.document()?.content).toBe('Writing must stay recoverable');
    expect(service.status()).toContain('Not saved');
    expect(service.error()).toBe('Draft volume unavailable');
    writable = true;
    expect(await service.flush()).toBe(true);
    expect(drafts.at(-1)).toMatchObject({ content: 'Writing must stay recoverable', revision: 'r1' });
    expect(service.dirty()).toBe(false);
    expect(service.error()).toBe('');
    expect(service.status()).toBe('Saved');
  });

  it('drains newer drafts before committing rather than persisting a stale snapshot', async () => {
    let finish!: () => void;
    let draftCount = 0;
    const { service, notebook } = setup(async (action, data) => {
      if (action === 'noteDraft' && ++draftCount === 1) await new Promise<void>(resolve => finish = resolve);
      if (action === 'noteSave') return { ...original, content: data.content, revision: 'r2' };
      return {};
    });
    service.change('First draft');
    const save = service.flush();
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change('Newest draft');
    finish();
    expect(await save).toBe(true);
    expect(notebook.mock.calls.filter(([action]) => action === 'noteSave').map(([, data]) => data.content)).toEqual(['Newest draft']);
    expect(service.document()?.content).toBe('Newest draft');
  });

  it('shares one save runner and rebases continued typing on the acknowledged revision', async () => {
    let finish!: (value: NoteDocument) => void;
    const saves: any[] = [];
    const { service, notebook } = setup(async (action, data) => {
      if (action === 'noteSave') {
        saves.push(data);
        if (saves.length === 1) return new Promise(resolve => finish = resolve);
        return { ...original, content: data.content, revision: 'r3' };
      }
      return {};
    });
    service.change('First commit');
    const first = service.flush();
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change('Typing during save');
    const second = service.flush();
    finish({ ...original, content: 'First commit', revision: 'r2' });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(saves.map(value => [value.content, value.revision])).toEqual([['First commit', 'r1'], ['Typing during save', 'r2']]);
    expect(notebook.mock.calls.filter(([action]) => action === 'noteDraft').at(-1)?.[1].record).toMatchObject({ content: 'Typing during save', revision: 'r2' });
    expect(service.dirty()).toBe(false);
  });

  it('does not restore an older open after a newer navigation has completed', async () => {
    let finish!: (value: NoteDocument) => void;
    const { service } = setup(async (action, data) => {
      if (action === 'noteRead') return data.path === 'slow.md' ? new Promise(resolve => finish = resolve) : { ...original, path: data.path, content: 'Latest selection' };
      if (action === 'noteReadDraft') return null;
      return {};
    });
    const slow = service.open('slow.md');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await service.open('new.md');
    finish({ ...original, path: 'slow.md', content: 'Obsolete read' });
    await slow;
    expect(service.document()?.path).toBe('new.md');
    expect(service.document()?.content).toBe('Latest selection');
    expect(service.loading()).toBe(false);
  });

  it('bounds slow draft writes to one in-flight snapshot and the newest of 1,000 edits', async () => {
    let finish!: () => void;
    const drafts: string[] = [];
    const { service, notebook } = setup(async (action, data) => {
      if (action === 'noteDraft') {
        drafts.push(data.record.content);
        if (drafts.length === 1) await new Promise<void>(resolve => finish = resolve);
      }
      if (action === 'noteSave') return { ...original, content: data.content, revision: 'r2' };
      return {};
    });
    service.change('Edit 0');
    await vi.waitFor(() => expect(finish).toBeDefined());
    for (let index = 1; index <= 1000; index++) service.change('Edit ' + index);
    const saving = service.flush();
    expect(drafts).toEqual(['Edit 0']);
    finish();
    expect(await saving).toBe(true);
    expect(drafts).toEqual(['Edit 0', 'Edit 1000']);
    expect(notebook.mock.calls.filter(([action]) => action === 'noteSave').map(([, data]) => data.content)).toEqual(['Edit 1000']);
    expect(service.document()?.content).toBe('Edit 1000');
    expect(service.dirty()).toBe(false);
  });

  it('keeps the same durable-draft requirement through the iPhone bridge', async () => {
    const { service, notebook } = setup(async () => { throw Error('Mac bridge should not be used'); });
    const postMessage = vi.fn(async (body: any) => {
      if (body.action === 'noteSave') return { ...original, content: body.content, revision: 'phone-r2' };
      return {};
    });
    (window as any).mapleHost = 'iphone';
    (window as any).webkit = { messageHandlers: { mapleCompanion: { postMessage } } };
    service.change('Writing on iPhone');
    expect(await service.flush()).toBe(true);
    expect(notebook).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.map(([body]) => body.action)).toEqual(['noteDraft', 'noteSave']);
    expect(service.document()?.revision).toBe('phone-r2');
  });
});

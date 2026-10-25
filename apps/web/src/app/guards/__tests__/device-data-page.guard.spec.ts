import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Route, UrlSegment } from '@angular/router';
import { BehaviorSubject, firstValueFrom, isObservable, type Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { Page } from '@maple/shared';
import { PageService } from '../../services/page.service';
import {
  ContactsPageGuard,
  HealthPageGuard,
  IMessagePageGuard,
  MailPageGuard,
} from '../device-data-page.guard';

const pages = new Map<string, Page>([
  ['msgs', { id: 'msgs', type: 'devicedata', deviceSource: 'imessage' } as Page],
  ['health', { id: 'health', type: 'devicedata', deviceSource: 'health' } as Page],
  ['memo', { id: 'memo', type: 'memo' } as Page],
]);

describe('device data page guards', () => {
  const store = new BehaviorSubject(pages);
  const setActivePageId = vi.fn();
  // Like PageService.select: emits once the page is in the store.
  const pageService = {
    setActivePageId,
    select: (id: string): Observable<Page> =>
      store.pipe(
        map((all) => all.get(id)),
        filter((page): page is Page => !!page),
      ),
  };

  beforeEach(() => {
    setActivePageId.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: PageService, useValue: pageService }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function run(guard: typeof IMessagePageGuard, ...paths: string[]): Promise<boolean> {
    const segments = paths.map((path) => ({ path }) as UrlSegment);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as Route, segments, {} as Parameters<typeof guard>[2]),
    );
    return isObservable(result)
      ? firstValueFrom(result as Observable<boolean>)
      : (result as boolean);
  }

  it('matches a device data page only for its own source', async () => {
    expect(await run(IMessagePageGuard, 'msgs')).toBe(true);
    expect(setActivePageId).toHaveBeenCalledWith('msgs');
    expect(await run(MailPageGuard, 'msgs')).toBe(false);
    expect(await run(HealthPageGuard, 'health')).toBe(true);
    expect(await run(ContactsPageGuard, 'health')).toBe(false);
  });

  it('never matches other page types, the new-page route or local pages', async () => {
    expect(await run(IMessagePageGuard, 'memo')).toBe(false);
    expect(await run(IMessagePageGuard, 'new')).toBe(false);
    expect(await run(IMessagePageGuard)).toBe(false);
    expect(await run(IMessagePageGuard, 'local-page-abc')).toBe(false);
    expect(setActivePageId).not.toHaveBeenCalled();
  });

  it('gives up when the page never reaches the store', async () => {
    vi.useFakeTimers();
    try {
      const pending = run(IMessagePageGuard, 'missing');
      await vi.advanceTimersByTimeAsync(5001);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

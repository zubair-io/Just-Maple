import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PageLinkSearchComponent } from '../page-link-search.component';
import { PageService } from '../../../../services/page.service';

describe('Local page links', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [PageLinkSearchComponent],
      providers: [
        {
          provide: PageService,
          useValue: {
            pages: signal([
              { id: 'current', title: 'Meeting draft', type: 'memo' },
              { id: 'other', title: 'Meeting notes', type: 'memo' },
            ]),
          },
        },
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('searches local metadata and excludes the open note', async () => {
    const fixture = TestBed.createComponent(PageLinkSearchComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('excludePageId', 'current');
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = 'Meeting';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.searchResults()).toEqual([]);
    await vi.advanceTimersByTimeAsync(151);
    fixture.detectChanges();
    expect(fixture.componentInstance.searchResults()).toEqual([
      { id: 'other', title: 'Meeting notes', type: 'memo' },
    ]);
    expect(fixture.nativeElement.textContent).toContain('Meeting notes');
    fixture.destroy();
  });

  it('selects a local result and closes the picker', () => {
    const fixture = TestBed.createComponent(PageLinkSearchComponent);
    const selected = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.selected.subscribe(selected);
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.selectPage({ id: 'other', title: 'Meeting notes', type: 'memo' });
    expect(selected).toHaveBeenCalledWith({
      pageId: 'other',
      title: 'Meeting notes',
      mode: 'inline',
    });
    expect(closed).toHaveBeenCalledOnce();
    fixture.destroy();
  });
});

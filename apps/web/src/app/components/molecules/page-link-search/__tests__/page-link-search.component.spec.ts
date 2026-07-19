import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PageLinkSearchComponent } from '../page-link-search.component';
import { Component, viewChild } from '@angular/core';

// Test host component to set inputs
@Component({
  standalone: true,
  imports: [PageLinkSearchComponent],
  template: `
    <app-page-link-search
      [isOpen]="isOpen"
      [mode]="mode"
      [notebookId]="notebookId"
      [excludePageId]="excludePageId"
      (closed)="onClosed()"
      (selected)="onSelected($event)"
      (createNew)="onCreateNew($event)"
    />
  `,
})
class TestHostComponent {
  isOpen = false;
  mode: 'inline' | 'block' = 'inline';
  notebookId = 'notebook-123';
  excludePageId = 'page-456';

  closedCalled = false;
  selectedEvent: any = null;
  createNewEvent: any = null;

  onClosed() {
    this.closedCalled = true;
  }
  onSelected(event: any) {
    this.selectedEvent = event;
  }
  onCreateNew(event: any) {
    this.createNewEvent = event;
  }
}

describe('PageLinkSearchComponent', () => {
  let hostComponent: TestHostComponent;
  let hostFixture: ComponentFixture<TestHostComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, TestHostComponent],
    }).compileComponents();

    hostFixture = TestBed.createComponent(TestHostComponent);
    hostComponent = hostFixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    hostFixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('initial state', () => {
    it('should not be visible when isOpen is false', () => {
      hostComponent.isOpen = false;
      hostFixture.detectChanges();

      const overlay = hostFixture.nativeElement.querySelector('.page-link-search-overlay');
      expect(overlay).toBeNull();
    });

    it('should be visible when isOpen is true', () => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const overlay = hostFixture.nativeElement.querySelector('.page-link-search-overlay');
      expect(overlay).not.toBeNull();
    });
  });

  describe('search functionality', () => {
    it('should debounce search input', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'test';
      input.dispatchEvent(new Event('input'));
      hostFixture.detectChanges();

      // Should not make request immediately
      expect(httpMock.match('/api/links/search').length).toBe(0);

      // Wait for debounce
      tick(200);

      // Now should make request
      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      expect(req.request.params.get('q')).toBe('test');
      expect(req.request.params.get('notebookId')).toBe('notebook-123');
      expect(req.request.params.get('excludePageId')).toBe('page-456');

      req.flush({ pages: [] });
    }));

    it('should display search results', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'meeting';
      input.dispatchEvent(new Event('input'));
      hostFixture.detectChanges();

      tick(200);

      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      req.flush({
        pages: [
          { id: 'page-1', title: 'Meeting Notes', type: 'memo' },
          { id: 'page-2', title: 'Team Meeting', type: 'memo' },
        ],
      });

      hostFixture.detectChanges();

      const results = hostFixture.nativeElement.querySelectorAll('.result-item');
      expect(results.length).toBe(2);
    }));

    it('should not search if query is empty', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = '';
      input.dispatchEvent(new Event('input'));
      hostFixture.detectChanges();

      tick(200);

      // Should not make any request
      httpMock.expectNone('/api/links/search');
    }));
  });

  describe('selection', () => {
    it('should emit selected event when page is clicked', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'test';
      input.dispatchEvent(new Event('input'));
      tick(200);

      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      req.flush({
        pages: [{ id: 'page-1', title: 'Test Page', type: 'memo' }],
      });
      hostFixture.detectChanges();

      const resultItem = hostFixture.nativeElement.querySelector('.result-item');
      resultItem.click();
      hostFixture.detectChanges();

      expect(hostComponent.selectedEvent).toEqual({
        pageId: 'page-1',
        title: 'Test Page',
        mode: 'inline',
      });
      expect(hostComponent.closedCalled).toBe(true);
    }));

    it('should emit createNew event when create button is clicked', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'New Page Title';
      input.dispatchEvent(new Event('input'));
      tick(200);

      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      req.flush({ pages: [] });
      hostFixture.detectChanges();

      const createButton = hostFixture.nativeElement.querySelector('.create-new');
      createButton?.click();
      hostFixture.detectChanges();

      expect(hostComponent.createNewEvent).toEqual({
        title: 'New Page Title',
        mode: 'inline',
      });
    }));
  });

  describe('keyboard navigation', () => {
    it('should close on Escape key', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      input.dispatchEvent(event);

      expect(hostComponent.closedCalled).toBe(true);
    }));

    it('should navigate with arrow keys', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'test';
      input.dispatchEvent(new Event('input'));
      tick(200);

      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      req.flush({
        pages: [
          { id: 'page-1', title: 'Page 1', type: 'memo' },
          { id: 'page-2', title: 'Page 2', type: 'memo' },
        ],
      });
      hostFixture.detectChanges();

      // Arrow down
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      input.dispatchEvent(downEvent);
      hostFixture.detectChanges();

      // Second item should be selected
      const selected = hostFixture.nativeElement.querySelector('.result-item.selected');
      expect(selected?.textContent).toContain('Page 2');
    }));
  });

  describe('overlay click', () => {
    it('should close when clicking overlay background', () => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const overlay = hostFixture.nativeElement.querySelector('.page-link-search-overlay');
      overlay.click();

      expect(hostComponent.closedCalled).toBe(true);
    });
  });

  describe('page icons', () => {
    it('should return correct icon for page type', fakeAsync(() => {
      hostComponent.isOpen = true;
      hostFixture.detectChanges();

      const input = hostFixture.nativeElement.querySelector('input');
      input.value = 'test';
      input.dispatchEvent(new Event('input'));
      tick(200);

      const req = httpMock.expectOne((r) => r.url.includes('/api/links/search'));
      req.flush({
        pages: [
          { id: 'page-1', title: 'Memo Page', type: 'memo' },
          { id: 'page-2', title: 'Whiteboard', type: 'whiteboard' },
        ],
      });
      hostFixture.detectChanges();

      const icons = hostFixture.nativeElement.querySelectorAll('.result-icon');
      expect(icons[0]?.textContent?.trim()).toBe('description');
      expect(icons[1]?.textContent?.trim()).toBe('draw');
    }));
  });
});

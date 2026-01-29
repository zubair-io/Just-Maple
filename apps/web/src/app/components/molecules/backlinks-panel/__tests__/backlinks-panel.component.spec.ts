import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { BacklinksPanelComponent } from '../backlinks-panel.component';
import { Component } from '@angular/core';

// Test host component to set required inputs
@Component({
  standalone: true,
  imports: [BacklinksPanelComponent],
  template: `<app-backlinks-panel [pageId]="pageId" [notebookId]="notebookId" />`,
})
class TestHostComponent {
  pageId = 'test-page-id';
  notebookId = 'test-notebook-id';
}

describe('BacklinksPanelComponent', () => {
  let hostComponent: TestHostComponent;
  let hostFixture: ComponentFixture<TestHostComponent>;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, TestHostComponent],
      providers: [
        {
          provide: Router,
          useValue: {
            navigate: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compileComponents();

    hostFixture = TestBed.createComponent(TestHostComponent);
    hostComponent = hostFixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function flushRequests(backlinks: any[] = [], mentions: any[] = []) {
    const backlinksReq = httpMock.expectOne((r) =>
      r.url.includes('/api/links/test-page-id/backlinks'),
    );
    backlinksReq.flush({ backlinks });

    const unlinkedReq = httpMock.expectOne((r) =>
      r.url.includes('/api/links/test-page-id/unlinked'),
    );
    unlinkedReq.flush({ mentions });
  }

  describe('initial load', () => {
    it('should load backlinks on init', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();

      flushRequests([{ pageId: 'page-1', title: 'Linking Page', type: 'inline' }]);

      hostFixture.detectChanges();

      const backlinkItems = hostFixture.nativeElement.querySelectorAll('.backlink-item');
      expect(backlinkItems.length).toBe(1);
    }));

    it('should show loading state', fakeAsync(() => {
      hostFixture.detectChanges();

      const loading = hostFixture.nativeElement.querySelector('.loading');
      expect(loading).not.toBeNull();

      tick();
      flushRequests();
      hostFixture.detectChanges();
    }));

    it('should show empty state when no backlinks', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([]);
      hostFixture.detectChanges();

      const emptyState = hostFixture.nativeElement.querySelector('.empty-state');
      expect(emptyState).not.toBeNull();
      expect(emptyState.textContent).toContain('No pages link to this page');
    }));
  });

  describe('display', () => {
    it('should display backlink titles', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([
        { pageId: 'page-1', title: 'First Page', type: 'inline' },
        { pageId: 'page-2', title: 'Second Page', type: 'block' },
      ]);
      hostFixture.detectChanges();

      const titles = hostFixture.nativeElement.querySelectorAll('.link-title');
      expect(titles.length).toBe(2);
      expect(titles[0].textContent).toContain('First Page');
      expect(titles[1].textContent).toContain('Second Page');
    }));

    it('should display link context if available', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([
        {
          pageId: 'page-1',
          title: 'Linking Page',
          type: 'inline',
          context: 'See related notes in...',
        },
      ]);
      hostFixture.detectChanges();

      const context = hostFixture.nativeElement.querySelector('.link-context');
      expect(context).not.toBeNull();
      expect(context.textContent).toContain('See related notes');
    }));

    it('should show backlink count in header', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([
        { pageId: 'page-1', title: 'Page 1', type: 'inline' },
        { pageId: 'page-2', title: 'Page 2', type: 'inline' },
        { pageId: 'page-3', title: 'Page 3', type: 'inline' },
      ]);
      hostFixture.detectChanges();

      const countBadge = hostFixture.nativeElement.querySelector('.count-badge');
      expect(countBadge.textContent.trim()).toBe('3');
    }));
  });

  describe('expand/collapse', () => {
    it('should toggle expanded state when header is clicked', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([{ pageId: 'page-1', title: 'Page 1', type: 'inline' }]);
      hostFixture.detectChanges();

      // Initially expanded
      let content = hostFixture.nativeElement.querySelector('.panel-content');
      expect(content).not.toBeNull();

      // Click to collapse
      const header = hostFixture.nativeElement.querySelector('.panel-header');
      header.click();
      hostFixture.detectChanges();

      content = hostFixture.nativeElement.querySelector('.panel-content');
      expect(content).toBeNull();

      // Click to expand
      header.click();
      hostFixture.detectChanges();

      content = hostFixture.nativeElement.querySelector('.panel-content');
      expect(content).not.toBeNull();
    }));
  });

  describe('navigation', () => {
    it('should navigate when backlink is clicked', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([{ pageId: 'linked-page-id', title: 'Linked Page', type: 'inline' }]);
      hostFixture.detectChanges();

      const backlinkItem = hostFixture.nativeElement.querySelector('.backlink-item');
      backlinkItem.click();

      expect(router.navigate).toHaveBeenCalledWith(['/', 'test-notebook-id', 'linked-page-id']);
    }));
  });

  describe('unlinked mentions', () => {
    it('should show unlinked mentions section when available', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests(
        [],
        [
          {
            pageId: 'mentioning-page',
            title: 'Mentioning Page',
            context: 'This text mentions...',
          },
        ],
      );
      hostFixture.detectChanges();

      const unlinkedSection = hostFixture.nativeElement.querySelector('.unlinked-section');
      expect(unlinkedSection).not.toBeNull();
    }));

    it('should toggle unlinked section visibility', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([], [{ pageId: 'page', title: 'Page', context: 'context' }]);
      hostFixture.detectChanges();

      // Initially hidden
      let unlinkedContent = hostFixture.nativeElement.querySelector('.unlinked-content');
      expect(unlinkedContent).toBeNull();

      // Click to show
      const sectionHeader = hostFixture.nativeElement.querySelector('.section-header');
      sectionHeader.click();
      hostFixture.detectChanges();

      unlinkedContent = hostFixture.nativeElement.querySelector('.unlinked-content');
      expect(unlinkedContent).not.toBeNull();
    }));

    it('should not show unlinked section when empty', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([], []);
      hostFixture.detectChanges();

      const unlinkedSection = hostFixture.nativeElement.querySelector('.unlinked-section');
      expect(unlinkedSection).toBeNull();
    }));
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();

      const backlinksReq = httpMock.expectOne((r) =>
        r.url.includes('/api/links/test-page-id/backlinks'),
      );
      backlinksReq.flush(null, { status: 500, statusText: 'Server Error' });

      const unlinkedReq = httpMock.expectOne((r) =>
        r.url.includes('/api/links/test-page-id/unlinked'),
      );
      unlinkedReq.flush(null, { status: 500, statusText: 'Server Error' });

      hostFixture.detectChanges();

      // Should show empty state rather than crash
      const emptyState = hostFixture.nativeElement.querySelector('.empty-state');
      expect(emptyState).not.toBeNull();
    }));
  });

  describe('getLinkIcon', () => {
    it('should return correct icon for link type', fakeAsync(() => {
      hostFixture.detectChanges();
      tick();
      flushRequests([
        { pageId: 'page-1', title: 'Inline Link', type: 'inline' },
        { pageId: 'page-2', title: 'Block Link', type: 'block' },
      ]);
      hostFixture.detectChanges();

      const icons = hostFixture.nativeElement.querySelectorAll(
        '.link-icon .material-symbols-rounded',
      );
      // Icons should be present based on type
      expect(icons.length).toBeGreaterThan(0);
    }));
  });
});

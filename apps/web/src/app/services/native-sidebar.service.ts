import { Injectable, inject, effect, DestroyRef, Injector } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NativeBridgeService } from './native-bridge.service';
import { PageService } from './page.service';
import { NotebookService } from './notebook.service';
import { MessageService } from './message.service';

@Injectable({
  providedIn: 'root',
})
export class NativeSidebarService {
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private initialized = false;

  init(): void {
    if (this.initialized || !this.nativeBridge.hasNativeSidebar()) return;
    this.initialized = true;

    this.listenForNativeEvents();
    this.pushStateToNative();
  }

  // MARK: - Listen for Native → Web events

  private listenForNativeEvents(): void {
    const sub1 = this.nativeBridge.onSidebarNavigate().subscribe(({ notebookId, pageId }) => {
      if (pageId) {
        this.router.navigate(['/', notebookId, pageId]);
      } else {
        this.router.navigate(['/', notebookId]);
      }
    });

    const sub2 = this.nativeBridge.onSidebarPageCreated().subscribe(({ page }) => {
      // Reload pages to pick up the new page from server
      this.pageService.loadPages({ notebookId: page.notebookId }).subscribe();
    });

    const sub3 = this.nativeBridge.onSidebarPageTrashed().subscribe(({ pageId }) => {
      // Reload pages to reflect the trash
      this.pageService.loadPages().subscribe();

      // Navigate away if the trashed page is currently active
      const activePage = this.pageService.selectedPageId();
      if (activePage === pageId) {
        const url = this.router.url;
        const segments = url.split('/').filter(Boolean);
        if (segments.length >= 1) {
          this.router.navigate(['/', segments[0]]);
        }
      }
    });

    const sub4 = this.nativeBridge.onSidebarPageRenamed().subscribe(() => {
      // Reload pages to get the updated title
      this.pageService.loadPages().subscribe();
    });

    const sub5 = this.nativeBridge.onSidebarPageMoved().subscribe(() => {
      // Reload pages to reflect the move
      this.pageService.loadPages().subscribe();
    });

    const sub6 = this.nativeBridge.onSidebarNotebookCreated().subscribe(() => {
      // Reload notebooks to pick up the new one
      this.notebookService.loadNotebooks().subscribe();
    });

    const sub7 = this.nativeBridge.onSidebarNotebookRenamed().subscribe(() => {
      // Reload notebooks to get updated label
      this.notebookService.loadNotebooks().subscribe();
    });

    const sub8 = this.nativeBridge.onSidebarNotebookDeleted().subscribe(({ notebookId }) => {
      // Reload notebooks
      this.notebookService.loadNotebooks().subscribe();

      // Navigate away if the deleted notebook is currently active
      const url = this.router.url;
      const segments = url.split('/').filter(Boolean);
      if (segments.length >= 1 && segments[0] === notebookId) {
        const notebooks = this.notebookService.notebooks();
        const remaining = notebooks.filter((n) => n._id !== notebookId);
        if (remaining.length > 0) {
          this.router.navigate(['/', remaining[0]._id]);
        } else {
          this.router.navigate(['/']);
        }
      }
    });

    const sub9 = this.nativeBridge.onSidebarNewPage().subscribe(({ notebookId, type }) => {
      this.router.navigate(['/', notebookId, 'new'], { queryParams: { type } });
    });

    this.destroyRef.onDestroy(() => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      sub4.unsubscribe();
      sub5.unsubscribe();
      sub6.unsubscribe();
      sub7.unsubscribe();
      sub8.unsubscribe();
      sub9.unsubscribe();
    });
  }

  // MARK: - Push Web → Native state

  private pushStateToNative(): void {
    // Push active route changes to native
    const routeSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const url = this.router.url;
        const segments = url.split('?')[0].split('/').filter(Boolean);
        this.nativeBridge.sendSidebarActiveChanged({
          notebookId: segments[0] || undefined,
          pageId: segments[1] || undefined,
        });
      });

    // Push unread count changes to native
    effect(
      () => {
        const counts = this.messageService.unreadCounts();
        this.nativeBridge.sendSidebarUnreadCounts({
          counts: counts.map((c) => ({ pageId: c.pageId, count: c.count })),
        });
      },
      { injector: this.injector },
    );

    this.destroyRef.onDestroy(() => {
      routeSub.unsubscribe();
    });
  }
}

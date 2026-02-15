import { Component, inject, signal, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd, ActivatedRoute } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotebookService } from '../../services/notebook.service';
import { PageService } from '../../services/page.service';
import { RealtimeService } from '../../services/realtime.service';
import { UiStateService } from '../../services/ui-state.service';
import { RealtimeWSService } from '../../services/realtime-ws.service';
import { LastVisitedService } from '../../services/last-visited.service';
import {
  SidebarComponent,
  TemplateGalleryModalComponent,
  SearchModalComponent,
  DialogComponent,
  DialogService,
} from '../../components';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    SidebarComponent,
    TemplateGalleryModalComponent,
    SearchModalComponent,
    DialogComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly authService = inject(AuthService);
  readonly notebookService = inject(NotebookService);
  readonly pageService = inject(PageService);
  private readonly realtimeService = inject(RealtimeService);
  readonly uiStateService = inject(UiStateService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly lastVisitedService = inject(LastVisitedService);
  private readonly dialogService = inject(DialogService);

  readonly selectedPageId = signal<string | null>(null);
  readonly selectedNotebookId = signal<string | null>(null);
  readonly sidebarOpen = this.uiStateService.sidebarOpen;
  readonly showTemplateGallery = this.uiStateService.showTemplateGallery;
  readonly showSearchModal = this.uiStateService.showSearchModal;

  // Keyboard shortcut for search (Cmd+K / Ctrl+K)
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.uiStateService.openSearchModal();
    }
  }

  // Swipe gesture tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;

  private routerSubscription?: Subscription;
  private queryParamsSubscription?: Subscription;
  private hasHandledInitialRedirect = false;

  ngOnInit(): void {
    // Try to redirect to last visited location before loading notebooks
    this.redirectToLastVisitedIfNeeded();

    // Ensure default notebook exists (notebooks auto-load via visibility service)
    this.notebookService.ensureDefaultNotebook().subscribe({
      next: () => {
        // Auto-select first notebook if on root path (only if we didn't redirect)
        if (!this.hasHandledInitialRedirect) {
          this.autoSelectFirstNotebook();
        }
      },
    });

    // Wait for auth to be ready before connecting to realtime services
    // This ensures the access token is available
    this.authService.initReady$.subscribe(() => {
      // Connect to realtime service
      this.realtimeService.connect();

      // Connect to unified WebSocket for real-time updates
      this.realtimeWS.connect();
    });

    // Sync selected IDs from route
    this.syncFromRoute();

    // Listen for route changes
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.syncFromRoute();
      });

    // Listen for query params to open search modal with filters
    this.queryParamsSubscription = this.route.queryParams.subscribe((params) => {
      const tag = params['tag'];
      const search = params['search'];

      if (tag || search) {
        // Open search modal with the filter
        this.uiStateService.openSearchModal({
          tag: tag || undefined,
          query: search || undefined,
        });

        // Clear query params from URL without triggering navigation
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.queryParamsSubscription?.unsubscribe();
    this.realtimeWS.disconnect();
  }

  private syncFromRoute(): void {
    const url = this.router.url;
    // Strip query params for segment parsing
    const pathOnly = url.split('?')[0];
    const segments = pathOnly.split('/').filter(Boolean);

    if (segments.length >= 1) {
      if (this.isNotebookRoute(segments)) {
        this.selectedNotebookId.set(segments[0]);
      } else {
        this.selectedNotebookId.set(null);
      }
    }

    if (segments.length >= 2) {
      // Second segment is id - find page by id and set selectedPageId
      const id = segments[1];
      const page = this.pageService.pages().find((n) => n.id === id);
      this.selectedPageId.set(page?.id || null);
    }

    // Cache or clear last visited location
    if (this.isNotebookRoute(segments)) {
      const notebookId = segments[0];
      if (this.isValidPageRoute(segments)) {
        // Cache both notebook and page
        this.lastVisitedService.save(notebookId, segments[1]);
      } else if (segments.length === 1) {
        // Just the notebook route (no child) - cache just the notebook
        this.lastVisitedService.save(notebookId);
      }
      // Don't cache special child routes like /new, /scan, /todos - they're transient actions
    } else if (segments.length > 0) {
      // Non-notebook route (settings, notifications, etc.) - clear the cache
      this.lastVisitedService.clear();
    }
  }

  private autoSelectFirstNotebook(): void {
    // Only redirect if on root path (no notebook selected)
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    if (segments.length === 0) {
      const notebooks = this.notebookService.notebooks();
      if (notebooks.length > 0) {
        this.router.navigate(['/', notebooks[0]._id]);
      }
    }
  }

  /**
   * Redirect to last visited notebook/page if we're on the root path
   */
  private redirectToLastVisitedIfNeeded(): void {
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    // Only redirect if on root path
    if (segments.length === 0) {
      const lastVisited = this.lastVisitedService.get();
      if (lastVisited) {
        this.hasHandledInitialRedirect = true;
        // Clear the cache after redirect to prevent repeated redirects
        this.lastVisitedService.clear();
        if (lastVisited.pageId) {
          this.router.navigate(['/', lastVisited.notebookId, lastVisited.pageId]);
        } else {
          this.router.navigate(['/', lastVisited.notebookId]);
        }
      }
    }
  }

  /**
   * Check if the current route is a notebook/page route that should be cached
   */
  private isNotebookRoute(segments: string[]): boolean {
    if (segments.length === 0) return false;
    const firstSegment = segments[0];
    // Exclude special routes that should not be cached
    const excludedRoutes = [
      'settings',
      'notifications',
      'favorites',
      'trash',
      'login',
      'verify',
      '!',
    ];
    return !excludedRoutes.includes(firstSegment);
  }

  /**
   * Check if the current route is a page within a notebook (not special routes like /new, /scan, /todos)
   */
  private isValidPageRoute(segments: string[]): boolean {
    if (segments.length < 2) return false;
    const secondSegment = segments[1];
    // Exclude special notebook child routes
    const excludedChildRoutes = ['new', 'scan', 'todos', 'collectible'];
    return !excludedChildRoutes.includes(secondSegment);
  }

  toggleSidebar(): void {
    this.uiStateService.toggleSidebar();
  }

  closeSidebar(): void {
    this.uiStateService.closeSidebar();
  }

  openLastPage(): void {
    const pages = this.pageService.pages();
    if (pages.length > 0) {
      // Get the most recently updated page
      const sortedPages = [...pages].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const lastPage = sortedPages[0];
      const urlParam = lastPage.id;
      if (lastPage.notebookId) {
        this.router.navigate(['/', lastPage.notebookId, urlParam]);
      } else {
        this.selectedPageId.set(lastPage.id);
      }
    }
  }

  onNewPage(type: 'memo' | 'whiteboard' | 'message' | 'kanban' | 'json' = 'memo'): void {
    // Get the selected notebook or use the first one
    const notebookId = this.selectedNotebookId() || this.notebookService.notebooks()[0]?._id;
    if (notebookId) {
      this.closeSidebar();
      this.router.navigate(['/', notebookId, 'new'], { queryParams: { type } });
    }
  }

  onNewFromTemplate(): void {
    this.closeSidebar();
    this.uiStateService.openTemplateGallery();
  }

  onTemplateGalleryClosed(): void {
    this.uiStateService.closeTemplateGallery();
  }

  onSearchClosed(): void {
    this.uiStateService.closeSearchModal();
  }

  onTemplateCreated(event: { pageId: string }): void {
    this.uiStateService.closeTemplateGallery();
    const notebookId = this.selectedNotebookId() || this.notebookService.notebooks()[0]?._id;
    if (notebookId) {
      // Page is already in store (optimistic update from client-side creation)
      this.router.navigate(['/', notebookId, event.pageId]);
    }
  }

  getSelectedNotebookName(): string {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return '';
    const notebook = this.notebookService.notebooks().find((n) => n._id === notebookId);
    return notebook?.label ?? '';
  }

  onSelectPage(pageId: string): void {
    this.selectedPageId.set(pageId);
  }

  onSelectNotebook(notebookId: string): void {
    this.selectedNotebookId.set(notebookId);
  }

  async onCreateNotebook(): Promise<void> {
    const name = await this.dialogService.prompt({
      title: 'New Notebook',
      message: 'Enter a name for the notebook:',
      placeholder: 'Notebook name',
      confirmLabel: 'Create',
    });
    if (!name) return;

    this.notebookService.createNotebook({ label: name }).subscribe({
      error: (error) => {
        console.error('Failed to create notebook:', error);
      },
    });
  }

  onSettings(): void {
    this.router.navigate(['/settings']);
  }

  createNewPage(): void {
    const notebookId = this.selectedNotebookId();
    // Create a new page and navigate to it
    const id = crypto.randomUUID();
    this.pageService
      .createPage({
        id,
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        notebookId: notebookId || undefined,
      })
      .subscribe({
        next: (page) => {
          const urlParam = page.id;
          if (notebookId) {
            this.router.navigate(['/', notebookId, urlParam]);
          } else {
            this.router.navigate(['/', urlParam]);
          }
        },
        error: (error) => {
          console.error('Failed to create page:', error);
        },
      });
  }

  onTouchStart(event: TouchEvent): void {
    // Only track touch events on mobile
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;

    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchStartTime = Date.now();
  }

  onTouchMove(event: TouchEvent): void {
    // Prevent default to allow swipe detection
    // But only if we're swiping from the left edge
    if (this.touchStartX < 50 && !this.sidebarOpen()) {
      const touch = event.touches[0];
      const deltaX = touch.clientX - this.touchStartX;

      // If swiping right, prevent scroll to make swipe smoother
      if (deltaX > 10) {
        event.preventDefault();
      }
    }
  }

  onTouchEnd(event: TouchEvent): void {
    // Only handle on mobile when sidebar is closed
    if (typeof window === 'undefined' || window.innerWidth >= 768 || this.sidebarOpen()) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = Math.abs(touch.clientY - this.touchStartY);
    const deltaTime = Date.now() - this.touchStartTime;

    // Swipe criteria:
    // - Start from left edge (< 50px)
    // - Swipe right (deltaX > 100px)
    // - More horizontal than vertical (deltaX > deltaY)
    // - Quick swipe (< 300ms)
    if (this.touchStartX < 50 && deltaX > 100 && deltaX > deltaY && deltaTime < 300) {
      this.uiStateService.openSidebar();
    }

    // Reset
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
  }
}

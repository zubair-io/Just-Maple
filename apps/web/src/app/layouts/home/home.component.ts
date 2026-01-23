import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subscription, filter, fromEvent } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotebookService } from '../../services/notebook.service';
import { PageService } from '../../services/page.service';
import { RealtimeService } from '../../services/realtime.service';
import { UiStateService } from '../../services/ui-state.service';
import { RealtimeWSService } from '../../services/realtime-ws.service';
import { SidebarComponent } from '../../components';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly notebookService = inject(NotebookService);
  readonly pageService = inject(PageService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly uiStateService = inject(UiStateService);
  private readonly realtimeWS = inject(RealtimeWSService);

  readonly selectedPageId = signal<string | null>(null);
  readonly selectedNotebookId = signal<string | null>(null);
  readonly sidebarOpen = this.uiStateService.sidebarOpen;
  readonly chatInputFocused = this.uiStateService.chatInputFocused;
  private readonly isMobile = signal(false);

  // Swipe gesture tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;

  // Computed: should show mobile footer padding
  readonly shouldShowFooterPadding = computed(() => {
    return this.isMobile() && !this.chatInputFocused();
  });

  private routerSubscription?: Subscription;
  private resizeSubscription?: Subscription;

  ngOnInit(): void {
    // Ensure default notebook exists (notebooks auto-load via visibility service)
    this.notebookService.ensureDefaultNotebook().subscribe({
      next: () => {
        // Auto-select first notebook if on root path
        this.autoSelectFirstNotebook();
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

    // Check if mobile on init
    this.checkIsMobile();

    // Listen for window resize
    if (typeof window !== 'undefined') {
      this.resizeSubscription = fromEvent(window, 'resize').subscribe(() => {
        this.checkIsMobile();
      });
    }
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.resizeSubscription?.unsubscribe();
    this.realtimeWS.disconnect();
  }

  private checkIsMobile(): void {
    if (typeof window !== 'undefined') {
      this.isMobile.set(window.innerWidth < 768);
    }
  }

  private syncFromRoute(): void {
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    if (segments.length >= 1) {
      // First segment is notebookId (if not a special route like 'favorites', 'trash')
      const firstSegment = segments[0];
      if (!['favorites', 'trash', 'login', 'verify'].includes(firstSegment)) {
        this.selectedNotebookId.set(firstSegment);
      }
    }

    if (segments.length >= 2) {
      // Second segment is id - find page by id and set selectedPageId
      const id = segments[1];
      const page = this.pageService.pages().find((n) => n.id === id);
      this.selectedPageId.set(page?.id || null);
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
      if (lastPage.tagId) {
        this.router.navigate(['/', lastPage.tagId, urlParam]);
      } else {
        this.selectedPageId.set(lastPage.id);
      }
    }
  }

  onNewPage(): void {
    // Will be handled by the page-view component
  }

  onSelectPage(pageId: string): void {
    this.selectedPageId.set(pageId);
  }

  onSelectNotebook(notebookId: string): void {
    this.selectedNotebookId.set(notebookId);
  }

  onCreateNotebook(): void {
    const name = prompt('Enter notebook name:');
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
    this.pageService
      .createPage({
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        tagId: notebookId || undefined,
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

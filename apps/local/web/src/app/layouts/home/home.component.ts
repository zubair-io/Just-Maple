import { Component, inject, signal, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd, ActivatedRoute } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { FolderService } from '../../services/folder.service';
import { PageService } from '../../services/page.service';
import { UiStateService } from '../../services/ui-state.service';
import { LastVisitedService } from '../../services/last-visited.service';
import { SidebarComponent } from '../../components/organisms/sidebar/sidebar.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly folderService = inject(FolderService);
  readonly pageService = inject(PageService);
  readonly uiStateService = inject(UiStateService);
  private readonly lastVisitedService = inject(LastVisitedService);

  readonly selectedPageId = signal<string | null>(null);
  readonly selectedFolderId = signal<string | null>(null);
  readonly sidebarOpen = this.uiStateService.sidebarOpen;

  // Swipe gesture tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;

  private routerSubscription?: Subscription;
  private hasHandledInitialRedirect = false;

  private nativeOpenFolderHandler = () => this.onOpenFolder();

  ngOnInit(): void {
    this.redirectToLastVisitedIfNeeded();
    this.syncFromRoute();

    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.syncFromRoute();
      });

    // Listen for native menu "Open Folder" command
    document.addEventListener('native-open-folder', this.nativeOpenFolderHandler);
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    document.removeEventListener('native-open-folder', this.nativeOpenFolderHandler);
  }

  private syncFromRoute(): void {
    const url = this.router.url;
    const pathOnly = url.split('?')[0];
    const segments = pathOnly
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));

    if (segments.length >= 1) {
      if (this.isFolderRoute(segments)) {
        this.selectedFolderId.set(segments[0]);
      } else {
        this.selectedFolderId.set(null);
      }
    }

    if (segments.length >= 2) {
      const id = segments[1];
      const page = this.pageService.pages().find((n: any) => n.id === id);
      this.selectedPageId.set(page?.id || null);
    }

    if (this.isFolderRoute(segments)) {
      const folderId = segments[0];
      if (this.isValidPageRoute(segments)) {
        this.lastVisitedService.save(folderId, segments[1]);
      } else if (segments.length === 1) {
        this.lastVisitedService.save(folderId);
      }
    } else if (segments.length > 0) {
      this.lastVisitedService.clear();
    }
  }

  private redirectToLastVisitedIfNeeded(): void {
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    if (segments.length === 0) {
      const lastVisited = this.lastVisitedService.get();
      if (lastVisited) {
        this.hasHandledInitialRedirect = true;
        this.lastVisitedService.clear();
        if (lastVisited.pageId) {
          this.router.navigate(['/', lastVisited.folderId, lastVisited.pageId]);
        } else {
          this.router.navigate(['/', lastVisited.folderId]);
        }
      }
    }
  }

  private isFolderRoute(segments: string[]): boolean {
    if (segments.length === 0) return false;
    const firstSegment = segments[0];
    const excludedRoutes = ['settings', 'atoms'];
    return !excludedRoutes.includes(firstSegment);
  }

  private isValidPageRoute(segments: string[]): boolean {
    if (segments.length < 2) return false;
    const secondSegment = segments[1];
    const excludedChildRoutes = ['new', 'todos'];
    return !excludedChildRoutes.includes(secondSegment);
  }

  toggleSidebar(): void {
    this.uiStateService.toggleSidebar();
  }

  closeSidebar(): void {
    this.uiStateService.closeSidebar();
  }

  onNewPage(): void {
    const folderId = this.selectedFolderId() || this.folderService.folders()[0]?._id;
    if (folderId) {
      this.closeSidebar();
      this.router.navigate(['/', folderId, 'new']);
    }
  }

  getSelectedFolderName(): string {
    const folderId = this.selectedFolderId();
    if (!folderId) return '';
    const folder = this.folderService.folders().find((n: any) => n._id === folderId);
    return folder?.label ?? '';
  }

  onSelectPage(pageId: string): void {
    this.selectedPageId.set(pageId);
  }

  onSelectFolder(folderId: string): void {
    this.selectedFolderId.set(folderId);
  }

  onOpenFolder(): void {
    this.folderService.openLocalFolder().subscribe((folder) => {
      if (folder) {
        this.selectedFolderId.set(folder._id);
        this.router.navigate(['/', folder._id]);
      }
    });
  }

  onSettings(): void {
    this.router.navigate(['/settings']);
  }

  onTouchStart(event: TouchEvent): void {
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;
    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchStartTime = Date.now();
  }

  onTouchMove(event: TouchEvent): void {
    if (this.touchStartX < 50 && !this.sidebarOpen()) {
      const touch = event.touches[0];
      const deltaX = touch.clientX - this.touchStartX;
      if (deltaX > 10) {
        event.preventDefault();
      }
    }
  }

  onTouchEnd(event: TouchEvent): void {
    if (typeof window === 'undefined' || window.innerWidth >= 768 || this.sidebarOpen()) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = Math.abs(touch.clientY - this.touchStartY);
    const deltaTime = Date.now() - this.touchStartTime;
    if (this.touchStartX < 50 && deltaX > 100 && deltaX > deltaY && deltaTime < 300) {
      this.uiStateService.openSidebar();
    }
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
  }
}

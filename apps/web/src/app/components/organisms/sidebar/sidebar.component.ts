import {
  Component,
  inject,
  signal,
  computed,
  output,
  input,
  OnInit,
  AfterViewChecked,
  Signal,
  ElementRef,
  ViewChildren,
  QueryList,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { AuthService } from '../../../services/auth.service';
import { NotebookService } from '../../../services/notebook.service';
import { PageService } from '../../../services/page.service';
import { MessageService } from '../../../services/message.service';
import { NotificationService } from '../../../services/notification.service';
import { NetworkService } from '../../../services/network.service';
import { ProfileAvatarComponent } from '../../atoms';
import { isLocalNotebook } from '../../../providers/data-provider.interface';
import type { Page, Notebook } from '@maple/shared';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, filter, map, switchMap } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ProfileAvatarComponent,
    DragDropModule,
    CdkOverlayOrigin,
    CdkConnectedOverlay,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit, AfterViewChecked {
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly authService = inject(AuthService);

  @ViewChildren('editInput') editInputs!: QueryList<ElementRef<HTMLInputElement>>;
  private shouldFocusInput = false;
  readonly notebookService = inject(NotebookService);
  readonly pageService = inject(PageService);
  readonly messageService = inject(MessageService);
  readonly notificationService = inject(NotificationService);
  readonly networkService = inject(NetworkService);
  readonly route = inject(ActivatedRoute);

  readonly selectedNotebookId = input<string | null>(null);
  readonly selectedPageId = toSignal(this.pageService.activeId$, { initialValue: null });

  readonly newPage = output<'memo' | 'whiteboard' | 'message' | 'kanban' | 'json'>();
  readonly newFromTemplate = output<void>();
  readonly selectPage = output<string>();
  readonly selectNotebook = output<string>();
  readonly createNotebook = output<void>();
  readonly settings = output<void>();
  readonly search = output<void>();

  readonly expandedNotebooks = signal<Set<string>>(new Set());
  readonly isNewDropdownOpen = signal(false);
  readonly newDropdownPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  readonly dragHoverNotebookId = signal<string | null>(null);
  readonly isSelectedNotebookLocal = computed(() =>
    isLocalNotebook(this.selectedNotebookId() ?? ''),
  );

  // Section-level "+" dropdown state
  readonly sectionDropdownOpen = signal<'public' | 'cloud' | 'icloud' | 'local' | null>(null);
  readonly sectionDropdownPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 767px)').pipe(map((result) => result.matches)),
    { initialValue: typeof window !== 'undefined' && window.innerWidth < 768 },
  );

  // Inline editing state
  readonly editingNotebookId = signal<string | null>(null);
  readonly editingPageId = signal<string | null>(null);
  readonly editValue = signal<string>('');
  getPagesForNotebook = toSignal(
    this.pageService.pages$.pipe(
      map((pages) => {
        return pages
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .reduce(
            (acc, page) => {
              (acc[page.notebookId || 'no_notebook'] ??= []).push(page);
              return acc;
            },
            {} as Record<string, Page[]>,
          );
      }),
    ),
    { initialValue: {} as Record<string, Page[]> },
  );

  // Auto-expand notebook and load local pages when selectedNotebookId changes
  private readonly _autoExpandNotebook = toSignal(
    toObservable(this.selectedNotebookId).pipe(
      filter((id): id is string => !!id),
      switchMap((notebookId) => {
        const wasExpanded = this.expandedNotebooks().has(notebookId);
        this.expandedNotebooks.update((notebooks) => {
          const newNotebooks = new Set(notebooks);
          newNotebooks.add(notebookId);
          return newNotebooks;
        });
        if (!wasExpanded && isLocalNotebook(notebookId)) {
          return this.pageService.loadLocalPages(notebookId);
        }
        return EMPTY;
      }),
    ),
  );

  // Reactive computed signals for user data
  readonly userInitials = computed(() => {
    const user = this.authService.user();
    if (!user) return '?';
    const name = user.displayName || user.email?.split('@')[0] || 'Maple user';
    return name.slice(0, 2).toUpperCase();
  });

  readonly userName = computed(() => {
    const user = this.authService.user();
    if (!user) return 'Guest';
    return user.displayName || user.email?.split('@')[0] || 'Maple user';
  });

  readonly notificationUnreadCount = computed(() => {
    return this.notificationService.totalUnreadCount();
  });

  readonly isOnline = this.networkService.isOnline;

  readonly statusText = computed(() => {
    return this.networkService.isOnline() ? 'Online' : 'Offline';
  });

  readonly statusColor = computed(() => {
    return this.networkService.isOnline() ? 'bg-green-500' : 'bg-gray-400';
  });

  readonly groupedNotebooks = computed(() => {
    const all = this.notebookService.notebooks();
    return {
      public: all.filter((nb) => !isLocalNotebook(nb._id) && nb.sharing?.['isPublic']),
      cloud: all.filter((nb) => !isLocalNotebook(nb._id) && !nb.sharing?.['isPublic']),
      icloud: all.filter((nb) => isLocalNotebook(nb._id) && this.notebookService.isICloud(nb._id)),
      local: all.filter((nb) => isLocalNotebook(nb._id) && !this.notebookService.isICloud(nb._id)),
    };
  });

  ngOnInit(): void {
    // Load unread counts when sidebar initializes
    this.messageService.loadUnreadCounts().subscribe();
  }

  ngAfterViewChecked(): void {
    if (this.shouldFocusInput && this.editInputs.length > 0) {
      const input = this.editInputs.first.nativeElement;
      input.focus();
      input.select();
      this.shouldFocusInput = false;
    }
  }

  getUnreadCount(notebookId: string): number {
    return this.messageService.getUnreadCount(notebookId);
  }

  readonly unreadCountsByPage = computed(() => {
    return this.messageService.unreadCounts().reduce(
      (acc, count) => {
        if (count.pageId) acc[count.pageId] = count.count;
        return acc;
      },
      {} as Record<string, number>,
    );
  });

  toggleNotebook(notebookId: string): void {
    const isExpanding = !this.expandedNotebooks().has(notebookId);

    this.expandedNotebooks.update((notebooks) => {
      const newNotebooks = new Set(notebooks);
      if (newNotebooks.has(notebookId)) {
        newNotebooks.delete(notebookId);
      } else {
        newNotebooks.add(notebookId);
      }
      return newNotebooks;
    });

    // Load local pages when expanding a local notebook
    if (isExpanding && isLocalNotebook(notebookId)) {
      this.pageService.loadLocalPages(notebookId).subscribe();
    }

    this.selectNotebook.emit(notebookId);
    this.pageService.setActivePageId(null);
    this.router.navigate(['/', notebookId]);
  }

  /**
   * Open a local folder as a notebook via file picker
   */
  onOpenLocalFolder(): void {
    this.isNewDropdownOpen.set(false);
    this.notebookService.openLocalFolder().subscribe((notebook) => {
      if (notebook) {
        // Expand the new local notebook and load its pages
        this.expandedNotebooks.update((notebooks) => {
          const updated = new Set(notebooks);
          updated.add(notebook._id);
          return updated;
        });
        this.pageService.loadLocalPages(notebook._id).subscribe();
        this.selectNotebook.emit(notebook._id);
        this.router.navigate(['/', notebook._id]);
      }
    });
  }

  getPageRouterLink(page: Page, notebookId: string): string[] {
    const urlParam = page.id;
    return ['/', notebookId, urlParam];
  }

  onNewPage(type: 'memo' | 'whiteboard' | 'message' | 'kanban' | 'json' = 'memo'): void {
    this.isNewDropdownOpen.set(false);
    this.newPage.emit(type);
  }

  onNewFromTemplate(): void {
    this.isNewDropdownOpen.set(false);
    this.newFromTemplate.emit();
  }

  toggleNewDropdown(): void {
    this.isNewDropdownOpen.update((v) => !v);
  }

  closeNewDropdown(): void {
    this.isNewDropdownOpen.set(false);
  }

  onSelectPage(page: Page): void {
    if (page.id === this.selectedPageId()) {
      this.startEditingPage(page.id, page.title, new Event('click'));
      return;
    }
    // Emit page id
    this.selectPage.emit(page.id);
  }

  onCreateNotebook(): void {
    this.isNewDropdownOpen.set(false);
    this.createNotebook.emit();
  }

  // Section-level "+" dropdown methods
  toggleSectionDropdown(section: 'public' | 'cloud' | 'icloud' | 'local'): void {
    this.sectionDropdownOpen.update((current) => (current === section ? null : section));
  }

  closeSectionDropdown(): void {
    this.sectionDropdownOpen.set(null);
  }

  onSectionNewPage(type: 'memo' | 'whiteboard' | 'message' | 'kanban' | 'json'): void {
    const section = this.sectionDropdownOpen();
    if (!section) return;
    const notebookId = this.getFirstNotebookInSection(section);
    this.closeSectionDropdown();
    if (!notebookId) return;
    this.selectNotebook.emit(notebookId);
    this.newPage.emit(type);
  }

  onSectionCreateNotebook(): void {
    const section = this.sectionDropdownOpen();
    this.closeSectionDropdown();
    if (section === 'local' || section === 'icloud') {
      this.onOpenLocalFolder();
    } else {
      this.createNotebook.emit();
    }
  }

  onSectionNewFromTemplate(): void {
    this.closeSectionDropdown();
    this.newFromTemplate.emit();
  }

  private getFirstNotebookInSection(
    section: 'public' | 'cloud' | 'icloud' | 'local',
  ): string | null {
    const notebooks = this.groupedNotebooks()[section];
    const selectedId = this.selectedNotebookId();
    if (selectedId && notebooks.some((nb) => nb._id === selectedId)) {
      return selectedId;
    }
    return notebooks[0]?._id ?? null;
  }

  onSettings(): void {
    this.settings.emit();
  }

  onSearch(): void {
    this.search.emit();
  }

  onNotifications(): void {
    this.router.navigate(['/notifications']);
  }

  onDropListEntered(notebookId: string): void {
    this.dragHoverNotebookId.set(notebookId);
  }

  onDropListExited(): void {
    this.dragHoverNotebookId.set(null);
  }

  onPageDrop(event: CdkDragDrop<string, string, Page>): void {
    this.dragHoverNotebookId.set(null);
    const page = event.item.data;
    const targetNotebookId = event.container.data;
    const sourceNotebookId = event.previousContainer.data;

    if (targetNotebookId === sourceNotebookId) return;

    this.pageService.updatePage(page.id, { notebookId: targetNotebookId }).subscribe();

    // Auto-expand target notebook
    this.expandedNotebooks.update((notebooks) => {
      const updated = new Set(notebooks);
      updated.add(targetNotebookId);
      return updated;
    });

    // Update route if the moved page is currently active
    if (this.selectedPageId() === page.id) {
      this.router.navigate(['/', targetNotebookId, page.id]);
    }
  }

  // Inline editing methods
  startEditingNotebook(notebookId: string, currentLabel: string, event: Event): void {
    event.stopPropagation();
    this.editingNotebookId.set(notebookId);
    this.editingPageId.set(null);
    this.editValue.set(currentLabel);
    this.shouldFocusInput = true;
  }

  startEditingPage(pageId: string, currentTitle: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.editingPageId.set(pageId);
    this.editingNotebookId.set(null);
    this.editValue.set(currentTitle);
    this.shouldFocusInput = true;
  }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  onEditBlur(): void {
    // Small delay to allow click events to fire first
    setTimeout(() => {
      if (this.editingNotebookId() || this.editingPageId()) {
        this.saveEdit();
      }
    }, 100);
  }

  private sanitizeInput(value: string): string {
    return value
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 255);
  }

  saveEdit(): void {
    const sanitizedValue = this.sanitizeInput(this.editValue());

    if (!sanitizedValue) {
      this.cancelEdit();
      return;
    }

    const notebookId = this.editingNotebookId();
    const pageId = this.editingPageId();

    if (notebookId) {
      const notebook = this.notebookService.notebooks().find((n) => n._id === notebookId);
      if (notebook && notebook.label !== sanitizedValue) {
        this.notebookService.updateNotebook(notebookId, { label: sanitizedValue }).subscribe();
      }
    } else if (pageId) {
      const pages = this.pageService.pages();
      const page = pages.find((p) => p.id === pageId);
      if (page && page.title !== sanitizedValue) {
        this.pageService.updatePage(page.id, { title: sanitizedValue }).subscribe();
      }
    }

    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editingNotebookId.set(null);
    this.editingPageId.set(null);
    this.editValue.set('');
  }

  onEditInputFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    input.select();
  }
}

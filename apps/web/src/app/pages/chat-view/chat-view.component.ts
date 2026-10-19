import { AppHeaderComponent } from '../../components/organisms/app-header/app-header.component';
import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterOutlet, NavigationEnd } from '@angular/router';
import {
  Subscription,
  switchMap,
  of,
  combineLatest,
  map,
  catchError,
  take,
  filter,
  startWith,
} from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { NotificationService } from '../../services/notification.service';
import { PageService } from '../../services/page.service';
import { MessageService } from '../../services/message.service';
import {
  ShareModalComponent,
  NotebookHeaderComponent,
  ConnectionGraphComponent,
  ChatComponent,
  DialogService,
  MemberAvatarGroupComponent,
  type GraphNode,
  type GraphEdge,
  type GraphStats,
} from '../../components';
import { getPageTypeLabel as getLabel, getPageTypeIcon as getIcon } from '../../utils/page-types';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import type { NotebookMember, Page, Message } from '@maple/shared';

interface NotebookSummary {
  pageCounts: Record<string, number>;
  totalPages: number;
  todoStats: { todoCount: number; completedCount: number; overdueCount: number };
}

interface ConnectionGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AppHeaderComponent,
    RouterOutlet,
    ShareModalComponent,
    NotebookHeaderComponent,
    ConnectionGraphComponent,
    ChatComponent,
    MemberAvatarGroupComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.scss',
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly notebookService = inject(NotebookService);
  private readonly notificationService = inject(NotificationService);
  private readonly pageService = inject(PageService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly showShareModal = signal<boolean>(false);
  readonly isEditingName = signal<boolean>(false);
  readonly editingName = signal<string>('');
  private readonly membersRefreshTrigger = signal<number>(0);
  private readonly summaryRefreshTrigger = signal<number>(0);

  // Tab navigation state
  readonly activeTab = signal<string>('overview');
  readonly childPageOpen = signal(false);
  readonly routePageId = signal<string | null>(null);
  readonly selectedHeaderTab = computed(() => {
    const pageId = this.routePageId();
    const page = pageId ? this.pageService.pages().find((p) => p.id === pageId) : null;
    return page ? `type-${page.type}` : this.activeTab();
  });
  readonly switcherOpen = signal<boolean>(false);
  readonly pageSearchQuery = signal<string>('');
  readonly newPageDropdownOpen = signal<boolean>(false);

  private readonly pinnedIds = signal<Set<string>>(this.loadPinnedIds());

  // Reactively load members when notebook changes or refresh is triggered
  readonly members = toSignal(
    combineLatest([
      toObservable(this.selectedNotebookId),
      toObservable(this.membersRefreshTrigger),
    ]).pipe(
      switchMap(([notebookId, _trigger]) =>
        notebookId && !isLocalNotebook(notebookId)
          ? this.notebookService.fetchNotebookMembers(notebookId)
          : of([]),
      ),
    ),
    { initialValue: [] as NotebookMember[] },
  );

  // Reactively load notebook summary when notebook changes
  readonly summary = toSignal(
    combineLatest([
      toObservable(this.selectedNotebookId),
      toObservable(this.summaryRefreshTrigger),
    ]).pipe(
      switchMap(([notebookId, _trigger]) =>
        notebookId && !isLocalNotebook(notebookId)
          ? this.notebookService.getNotebookSummary(notebookId).pipe(
              map((response) => response.summary),
              catchError(() => of(null)),
            )
          : of(null),
      ),
    ),
    { initialValue: null as NotebookSummary | null },
  );

  // Reactively load connection graph when notebook changes
  readonly connectionGraph = toSignal(
    combineLatest([
      toObservable(this.selectedNotebookId),
      toObservable(this.summaryRefreshTrigger),
    ]).pipe(
      switchMap(([notebookId, _trigger]) =>
        notebookId && !isLocalNotebook(notebookId)
          ? this.notebookService.getConnectionGraph(notebookId).pipe(
              map((response) => response.graph as ConnectionGraphData),
              catchError(() => of(null)),
            )
          : of(null),
      ),
    ),
    { initialValue: null as ConnectionGraphData | null },
  );

  readonly dynamicTabs = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return [];

    const pages = this.isLocal()
      ? this.localPages()
      : this.pageService.pages().filter((p) => p.notebookId === notebookId);

    const types = [...new Set(pages.map((p) => p.type))];

    return types.map((type) => ({
      id: `type-${type}`,
      type,
      label: this.getPageTypeTabLabel(type),
    }));
  });

  readonly filteredPagesForActiveTab = computed(() => {
    const tab = this.activeTab();
    const pages = this.notebookPages();

    if (tab.startsWith('type-')) {
      const targetType = tab.substring(5);
      return pages.filter((p) => p.type === targetType);
    }
    return [];
  });

  private getPageTypeTabLabel(type: string): string {
    switch (type) {
      case 'memo':
        return 'Notes';
      case 'whiteboard':
        return 'Whiteboards';
      case 'kanban':
        return 'Kanbans';
      case 'message':
        return 'Chats';
      case 'json':
        return 'JSON Pages';
      case 'canvas':
        return 'Canvases';
      case 'collectable':
        return 'Collectibles';
      default:
        return `${type.charAt(0).toUpperCase() + type.slice(1)}s`;
    }
  }

  constructor() {
    // Track active notebook for smart notification filtering and message loading
    effect(() => {
      const notebookId = this.selectedNotebookId();
      this.notificationService.setActiveNotebook(notebookId);

      const isValidObjectId = notebookId && /^[0-9a-fA-F]{24}$/.test(notebookId);
      if (notebookId && isValidObjectId) {
        // Load messages for the notebook chat
        this.messageService.loadMessages(notebookId).subscribe();
      }
    });

    // Make sure activeTab falls back to overview if the selected page type tab is no longer available
    effect(() => {
      const tab = this.activeTab();
      if (
        tab.startsWith('type-') &&
        !this.pageService.isLoading() &&
        this.pageService.pages().length > 0
      ) {
        const available = this.dynamicTabs().some((t) => t.id === tab);
        if (!available) {
          this.activeTab.set('overview');
        }
      }
    });
  }

  // Computed signals reactively derive from store
  readonly selectedNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return null;
    return this.notebookService.notebooks().find((n) => n._id === notebookId) || null;
  });

  readonly isLocal = computed(() => isLocalNotebook(this.selectedNotebookId() ?? ''));

  readonly localPages = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId || !this.isLocal()) return [];
    return this.pageService.pages().filter((p) => p.notebookId === notebookId);
  });

  readonly switcherItems = computed(() => {
    const all = this.notebookService.notebooks();
    const activeId = this.selectedNotebookId();
    return all.map((nb) => ({
      _id: nb._id,
      name: nb.label,
      active: nb._id === activeId,
      pinned: this.pinnedIds().has(nb._id),
      unreadCount: this.messageService.getUnreadCount(nb._id),
      unreadLabel:
        this.messageService.getUnreadCount(nb._id) > 99
          ? '99+'
          : String(this.messageService.getUnreadCount(nb._id)),
    }));
  });

  readonly recentPages = computed(() => {
    const pages = this.isLocal()
      ? this.localPages()
      : this.pageService.pages().filter((p) => p.notebookId === this.selectedNotebookId());
    return pages.slice(0, 3);
  });

  readonly recentMessages = computed(() => {
    const all = this.messageService.messagesForTag();
    return all.slice(-2);
  });

  readonly navigationPages = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return [];

    const pages = this.isLocal()
      ? this.localPages()
      : this.pageService.pages().filter((p) => p.notebookId === notebookId);

    return pages.filter((page) => !page.isTrashed);
  });

  readonly notebookPages = computed(() => {
    const pages = this.navigationPages();
    const query = this.pageSearchQuery().trim().toLowerCase();
    return pages.filter((p) => !query || p.title.toLowerCase().includes(query));
  });

  // Delegate to shared utilities
  getPageTypeLabel = getLabel;
  getPageTypeIcon = getIcon;

  ngOnInit(): void {
    this.routeSubscription = combineLatest([
      this.route.params,
      this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
      ),
    ]).subscribe(([params]) => {
      const notebookId = params['notebookId'] || null;
      const notebookChanged = notebookId !== this.selectedNotebookId();
      const wasChildPageOpen = this.childPageOpen();
      this.selectedNotebookId.set(notebookId);
      this.notificationService.setActiveNotebook(notebookId);
      this.childPageOpen.set(!!this.route.firstChild);
      this.routePageId.set(this.route.firstChild?.snapshot.paramMap.get('id') ?? null);
      if (notebookChanged) {
        this.activeTab.set('overview');
        this.pageSearchQuery.set('');
        if (notebookId && isLocalNotebook(notebookId)) {
          this.pageService.loadLocalPages(notebookId).pipe(take(1)).subscribe();
        }
      }
      const tab = this.route.snapshot.queryParamMap.get('tab');
      if (!this.childPageOpen() && tab) this.activeTab.set(tab);
      if (wasChildPageOpen && !this.childPageOpen()) {
        this.summaryRefreshTrigger.update((value) => value + 1);
      }
      this.switcherOpen.set(false);
      this.newPageDropdownOpen.set(false);
    });
  }

  selectTab(tab: string): void {
    this.switcherOpen.set(false);
    this.activeTab.set(tab);
    this.router.navigate(['/', this.selectedNotebookId()], {
      queryParams: { tab: tab === 'overview' ? null : tab },
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    // Clear active notebook when leaving chat view
    this.notificationService.setActiveNotebook(null);
  }

  private loadPinnedIds(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    const val = localStorage.getItem('maple-pinned-notebooks');
    if (!val) return new Set();
    try {
      return new Set(JSON.parse(val));
    } catch {
      return new Set();
    }
  }

  togglePin(notebookId: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.pinnedIds.update((set) => {
      const next = new Set(set);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('maple-pinned-notebooks', JSON.stringify([...next]));
      }
      return next;
    });
  }

  isPinned(notebookId: string): boolean {
    return this.pinnedIds().has(notebookId);
  }

  openShareModal(): void {
    this.showShareModal.set(true);
  }

  closeShareModal(): void {
    this.showShareModal.set(false);
  }

  onMembersChanged(): void {
    // Trigger members refetch after sharing/unsharing
    this.membersRefreshTrigger.update((n) => n + 1);
  }

  startEditingName(): void {
    const notebook = this.selectedNotebook();
    if (notebook) {
      this.editingName.set(notebook.label);
      this.isEditingName.set(true);
    }
  }

  saveNotebookName(): void {
    const notebookId = this.selectedNotebookId();
    const newName = this.editingName().trim();
    if (notebookId && newName) {
      this.notebookService.updateNotebook(notebookId, { label: newName }).subscribe({
        next: () => {
          this.isEditingName.set(false);
        },
        error: () => {
          // Keep editing mode on error
        },
      });
    }
  }

  cancelEditingName(): void {
    this.isEditingName.set(false);
  }

  onNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveNotebookName();
    } else if (event.key === 'Escape') {
      this.cancelEditingName();
    }
  }

  onFileClicked(pageId: string): void {
    this.switcherOpen.set(false);
    const notebookId = this.selectedNotebookId();
    if (notebookId) {
      this.router.navigate(['/', notebookId, pageId]);
    }
  }

  // Handle graph node click - navigate to the page
  onGraphNodeClicked(pageId: string): void {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;

    // Check if clicked node is a kanban card memo
    const graph = this.connectionGraph();
    if (graph) {
      const node = graph.nodes.find((n) => n.id === pageId);
      if (node?.type === 'kanban-card') {
        // Find parent kanban board from edges
        const parentEdge = graph.edges.find((e) => {
          const targetId = typeof e.target === 'string' ? e.target : e.target.id;
          return targetId === pageId;
        });
        if (parentEdge) {
          const boardId =
            typeof parentEdge.source === 'string' ? parentEdge.source : parentEdge.source.id;
          this.router.navigate(['/', notebookId, boardId, pageId]);
          return;
        }
      }
    }

    this.router.navigate(['/', notebookId, pageId]);
  }

  selectNotebook(notebookId: string): void {
    this.switcherOpen.set(false);
    this.router.navigate(['/', notebookId]);
  }

  async createNewNotebook(): Promise<void> {
    this.switcherOpen.set(false);
    const name = await this.dialogService.prompt({
      title: 'New Notebook',
      message: 'Enter a name for the notebook:',
      placeholder: 'Notebook name',
      confirmLabel: 'Create',
    });
    if (!name) return;

    this.notebookService.createNotebook({ label: name }).subscribe({
      next: (nb) => {
        if (nb) {
          this.router.navigate(['/', nb._id]);
        }
      },
      error: (error) => {
        console.error('Failed to create notebook:', error);
      },
    });
  }

  createNewPage(type: 'memo' | 'whiteboard' | 'message' | 'kanban' | 'json' = 'memo'): void {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;

    const id = crypto.randomUUID();
    this.pageService
      .createPage({
        id,
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        notebookId: notebookId || undefined,
        type,
      })
      .subscribe({
        next: (page) => {
          this.router.navigate(['/', notebookId, page.id]);
        },
        error: (error) => {
          console.error('Failed to create page:', error);
        },
      });
  }

  toggleNewPageDropdown(event: Event): void {
    event.stopPropagation();
    this.newPageDropdownOpen.update((v) => !v);
  }
}

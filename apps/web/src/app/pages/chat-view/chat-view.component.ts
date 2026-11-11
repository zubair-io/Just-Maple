import { AssistancePanelComponent } from '../../components/organisms/assistance-panel/assistance-panel.component';
import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  effect,
  untracked,
  viewChild,
  viewChildren,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterOutlet, NavigationEnd } from '@angular/router';
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
  lastValueFrom,
} from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { NotificationService } from '../../services/notification.service';
import { PageService } from '../../services/page.service';
import { MessageService } from '../../services/message.service';
import { DeviceDataService } from '../../services/device-data.service';
import {
  BAND_BUTTON_CLASS,
  CARD_BAND_CLASS,
  CARD_CLASS,
  CIRCLE_BUTTON_CLASS,
  KICKER_CLASS,
  LIST_ROW_ACTIVE_CLASS,
  LIST_ROW_IDLE_CLASS,
} from '../../utils/shell-classes';
import { OpenPagesService } from '../../services/open-pages.service';
import { RecorderWorkspaceService } from '../../services/recorder-workspace.service';
import { DEVICE_DATA_SOURCES, deviceSourceInfo } from '../../utils/device-sources';
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
import {
  getPageTypeLabel as getLabel,
  getPageTypeIcon as getIcon,
  getPageTypeName,
} from '../../utils/page-types';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import type { NotebookMember, Page, Message, MacDataSource } from '@maple/shared';
import { aboutMePageId, activityPageId, followUpsPageId, graphPageId } from '@maple/shared';

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

/** Pages that read as a column; every other type takes the width of the row. */
const NARROW_PAGE_TYPES = new Set(['memo', 'message', 'aboutme', 'activity', 'followups']);

/** Views under a notebook that aren't pages. */
const VIEW_NAMES: Record<string, { label: string; icon: string }> = {
  today: { label: 'Today', icon: 'today' },
  todos: { label: 'Todos', icon: 'checklist' },
  new: { label: 'New page', icon: 'add' },
  scan: { label: 'Scan', icon: 'barcode_scanner' },
};

/** Pages each notebook has at most one of, offered beside the overview. */
const SINGLETON_PAGES = [
  { type: 'aboutme', label: 'About me', icon: 'person' },
  { type: 'graph', label: 'Graph', icon: 'hub' },
  { type: 'activity', label: 'Activity', icon: 'monitoring' },
  { type: 'followups', label: 'Follow-ups', icon: 'reply' },
] as const;

type SingletonPageType = (typeof SINGLETON_PAGES)[number]['type'];

const ACCESS_LEVEL_NAMES: Record<string, string> = {
  owner: 'Owner',
  write: 'Member',
  read: 'Viewer',
};

const PILL_CLASS =
  'flex-none flex items-center gap-2 h-9 max-w-[200px] px-3.5 rounded-[10px] bg-[var(--color-row-active)] font-sans text-[13px] no-underline transition-opacity';

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    ShareModalComponent,
    NotebookHeaderComponent,
    ConnectionGraphComponent,
    ChatComponent,
    AssistancePanelComponent,
    MemberAvatarGroupComponent,
  ],
  templateUrl: './chat-view.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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
  private readonly deviceData = inject(DeviceDataService);
  private readonly openPagesService = inject(OpenPagesService);
  readonly recorder = inject(RecorderWorkspaceService);

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly showShareModal = signal<boolean>(false);
  readonly isEditingName = signal<boolean>(false);
  readonly editingName = signal<string>('');
  private readonly membersRefreshTrigger = signal<number>(0);
  private readonly summaryRefreshTrigger = signal<number>(0);

  // Tab navigation state
  readonly assistanceOpen = signal(false);
  readonly assistanceSelection = signal('');
  readonly isToday = signal(false);
  readonly assistancePage = computed(
    () => this.pageService.pages().find((page) => page.id === this.routePageId()) ?? null,
  );
  captureAssistanceSelection(): void {
    this.assistanceSelection.set(window.getSelection()?.toString().slice(0, 10000) || '');
  }
  openToday(): void {
    this.assistanceOpen.set(false);
    void this.router.navigate(['/', this.selectedNotebookId(), 'today']);
  }
  readonly childPageOpen = signal(false);
  readonly routePageId = signal<string | null>(null);
  readonly newPageDropdownOpen = signal<boolean>(false);

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

    // Keep the editor toolbar centred on the card in first place as it resizes.
    effect((onCleanup) => {
      const card = this.frontCard()?.nativeElement;
      if (!card || typeof ResizeObserver === 'undefined') return;
      const place = () => this.placeEditorToolbar();
      const observer = new ResizeObserver(place);
      observer.observe(card);
      window.addEventListener('resize', place);
      place();
      onCleanup(() => {
        observer.disconnect();
        window.removeEventListener('resize', place);
      });
    });

    // Tell the strip which open pages are on screen and which wait off to the right.
    effect((onCleanup) => {
      const cards = this.openCards();
      if (typeof IntersectionObserver === 'undefined' || cards.length === 0) {
        untracked(() => this.visibleIds.set(new Set()));
        return;
      }
      const seen = new Map<string, boolean>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset['pageId'];
            if (id) seen.set(id, entry.intersectionRatio >= 0.35);
          }
          this.visibleIds.set(new Set([...seen].filter(([, on]) => on).map(([id]) => id)));
        },
        { threshold: [0, 0.35, 1] },
      );
      for (const card of cards) observer.observe(card.nativeElement);
      onCleanup(() => observer.disconnect());
    });

    // A page that is opened takes first place in the row of open pages.
    effect(() => {
      const notebookId = this.selectedNotebookId();
      const page = this.frontPage();
      if (notebookId && page) untracked(() => this.openPagesService.open(notebookId, page.id));
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

  /** This notebook's chats, for choosing where a bot is proactive. */
  readonly chatPages = computed(() =>
    this.navigationPages().filter((page) => page.type === 'message'),
  );

  /** "+ New" offers About me only until the notebook has one. */
  readonly hasAboutMePage = computed(() =>
    this.navigationPages().some((page) => page.type === 'aboutme'),
  );

  /** "+ New" offers Graph only until the notebook has one. */
  readonly hasGraphPage = computed(() =>
    this.navigationPages().some((page) => page.type === 'graph'),
  );

  /** "+ New" offers Activity only until the notebook has one. */
  readonly hasActivityPage = computed(() =>
    this.navigationPages().some((page) => page.type === 'activity'),
  );

  /** "+ New" offers Follow-ups only until the notebook has one. */
  readonly hasFollowUpsPage = computed(() =>
    this.navigationPages().some((page) => page.type === 'followups'),
  );

  /** Device data sources offered in "+ New" on every device (Mac and iPhone sources). */
  readonly deviceSources = DEVICE_DATA_SOURCES;

  // Delegate to shared utilities
  getPageTypeLabel = getLabel;
  getPageTypeIcon = getIcon;

  /** A device data page shows its source's icon; other pages their type's. */
  pageIcon(page: Page): string {
    return page.type === 'devicedata' && page.deviceSource
      ? deviceSourceInfo(page.deviceSource).icon
      : getIcon(page.type);
  }

  /** The page in first place: the one the route shows. */
  readonly frontPage = computed(
    () => this.navigationPages().find((page) => page.id === this.routePageId()) ?? null,
  );

  /** This notebook's open pages, first place first. */
  readonly openPages = computed(() => {
    const byId = new Map(this.navigationPages().map((page) => [page.id, page]));
    return this.openPagesService
      .ids(this.selectedNotebookId())
      .map((id) => byId.get(id))
      .filter((page): page is Page => !!page);
  });

  /** Open pages to the right of the one in first place. */
  readonly peekPages = computed(() =>
    this.openPages().filter((page) => page.id !== this.routePageId()),
  );

  readonly openIds = computed(() => new Set(this.openPages().map((page) => page.id)));

  /** Route under the notebook that isn't a page (Today, Todos...). */
  private readonly childPath = signal<string | null>(null);

  readonly frontIcon = computed(() => {
    const page = this.frontPage();
    if (page) return this.pageIcon(page);
    if (!this.childPageOpen()) return 'dashboard';
    return VIEW_NAMES[this.childPath() ?? '']?.icon ?? 'description';
  });

  readonly frontLabel = computed(() => {
    const page = this.frontPage();
    if (page) return this.pageTypeName(page);
    if (!this.childPageOpen()) return 'Overview';
    return VIEW_NAMES[this.childPath() ?? '']?.label ?? 'Page';
  });

  /** Memos and chats are a column; boards and drawings take the width. */
  readonly frontCardClass = computed(() => {
    const page = this.frontPage();
    const narrow = !!page && NARROW_PAGE_TYPES.has(page.type);
    const width = narrow
      ? 'md:w-[clamp(440px,48%,620px)]'
      : this.peekPages().length > 0
        ? 'md:w-[calc(100%-88px)]'
        : 'md:w-full';
    return `${CARD_CLASS} w-full md:flex-none md:min-h-0 [--editor-toolbar-rest:4.75rem] md:[--editor-toolbar-rest:6.75rem] ${width}`;
  });

  readonly sideCardClass = `${CARD_CLASS} hidden md:flex flex-none w-[400px] min-h-0`;
  readonly kickerClass = KICKER_CLASS;
  readonly circleClass = CIRCLE_BUTTON_CLASS;
  readonly rowIdleClass = LIST_ROW_IDLE_CLASS;
  readonly rowActiveClass = LIST_ROW_ACTIVE_CLASS;
  readonly bandClass = CARD_BAND_CLASS;
  readonly bandButtonClass = BAND_BUTTON_CLASS;
  readonly nameOnListClass = 'text-[32px] leading-[40px] font-light tracking-[-0.01em]';
  readonly nameOnPageClass = 'text-[17px] leading-[38px] font-bold';
  readonly pillOn = `${PILL_CLASS} font-bold text-[var(--color-text-main)] shadow-[0_1px_2px_rgba(41,37,36,0.05)]`;
  readonly pillOff = `${PILL_CLASS} text-[var(--color-text-muted)] opacity-55 hover:opacity-100`;
  readonly singletonPages = SINGLETON_PAGES;

  private readonly frontCard = viewChild<ElementRef<HTMLElement>>('frontCard');

  /**
   * The memo editor's toolbar floats over the page. Tell it where the card in
   * first place is, so it sits inside that card and not across its neighbours.
   */
  placeEditorToolbar(): void {
    const card = this.frontCard()?.nativeElement;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    card.style.setProperty('--editor-toolbar-left', `${Math.round((left + right) / 2)}px`);
    card.style.setProperty('--editor-toolbar-max', `${Math.max(right - left - 24, 200)}px`);
  }

  /** Cards in the row, watched so the strip can tell on screen from waiting. */
  private readonly openCards = viewChildren<ElementRef<HTMLElement>>('openCard');
  private readonly visibleIds = signal<Set<string>>(new Set());

  /** Open pages a person can see now; the one in first place always counts. */
  readonly onScreenIds = computed(() => {
    const ids = new Set(this.visibleIds());
    const front = this.routePageId();
    if (front) ids.add(front);
    return ids;
  });

  readonly pageCountLabel = computed(() => {
    const count = this.navigationPages().length;
    return count === 1 ? '1 page' : `${count} pages`;
  });

  /** The quiet line under a page's name: its type, and what is waiting in it. */
  pageNote(page: Page): string {
    const name = this.pageTypeName(page);
    if (page.type === 'message') {
      const unread = this.messageService.getUnreadCountByPageId(page.id);
      if (unread > 0) return `${name} · ${unread} unread`;
    }
    const todos = page.todoMeta;
    if (todos?.hasTodos) {
      const open = todos.todoCount - todos.completedCount;
      if (todos.overdueCount > 0) return `${name} · ${todos.overdueCount} overdue`;
      if (open > 0) return `${name} · ${open} ${open === 1 ? 'todo' : 'todos'}`;
    }
    return name;
  }

  memberName(member: NotebookMember): string {
    return member.displayName || member.email?.split('@')[0] || 'Member';
  }

  memberInitial(member: NotebookMember): string {
    return this.memberName(member).charAt(0);
  }

  memberRole(member: NotebookMember): string {
    return ACCESS_LEVEL_NAMES[member.accessLevel] ?? member.accessLevel;
  }

  /** Opens the notebook's About me, Graph, Activity or Follow-ups, adding it first if needed. */
  openSingleton(type: SingletonPageType): void {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    const existing = this.navigationPages().find((page) => page.type === type);
    if (existing) {
      void this.router.navigate(['/', notebookId, existing.id]);
      return;
    }
    if (type === 'aboutme') void this.createAboutMePage();
    else if (type === 'graph') void this.createGraphPage();
    else if (type === 'activity') void this.createActivityPage();
    else void this.createFollowUpsPage();
  }

  /** "Memo", "Chat", "Calendar": what a page is, in Maple's words. */
  pageTypeName(page: Page): string {
    return getPageTypeName(page.type);
  }

  hasUnread(page: Page): boolean {
    return page.type === 'message' && this.messageService.hasUnreadByPageId(page.id);
  }

  /** Closes an open page; closing the one in first place shows the next. */
  closePage(pageId: string): void {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    const wasFront = pageId === this.routePageId();
    this.openPagesService.close(notebookId, pageId);
    if (wasFront) this.showNextOpenPage(notebookId);
  }

  closeFront(): void {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    const pageId = this.routePageId();
    if (pageId) this.openPagesService.close(notebookId, pageId);
    this.showNextOpenPage(notebookId);
  }

  private showNextOpenPage(notebookId: string): void {
    const next = this.openPages().find((page) => page.id !== this.routePageId());
    void this.router.navigate(next ? ['/', notebookId, next.id] : ['/', notebookId]);
  }

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
      this.isToday.set(this.route.firstChild?.snapshot.routeConfig?.path === 'today');
      this.childPath.set(this.route.firstChild?.snapshot.routeConfig?.path ?? null);
      this.assistanceOpen.set(false);
      if (notebookChanged) {
        if (notebookId && isLocalNotebook(notebookId)) {
          this.pageService.loadLocalPages(notebookId).pipe(take(1)).subscribe();
        }
      }
      if (wasChildPageOpen && !this.childPageOpen()) {
        this.summaryRefreshTrigger.update((value) => value + 1);
      }
      this.newPageDropdownOpen.set(false);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    // Clear active notebook when leaving chat view
    this.notificationService.setActiveNotebook(null);
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

  /** Creates a cloud page for one source of the user's device data and opens it. */
  async createDeviceDataPage(source: MacDataSource): Promise<void> {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    try {
      const page = await this.deviceData.createPage(notebookId, source);
      await this.router.navigate(['/', notebookId, page.id]);
    } catch (error) {
      console.error('Failed to create device data page:', error);
      await this.dialogService.alert({
        title: 'Could not add the page',
        message: 'Check your connection and try again.',
      });
    }
  }

  /** Adds the notebook's About me page (bots fill it in) and opens it. */
  async createAboutMePage(): Promise<void> {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    try {
      const page = await lastValueFrom(
        this.pageService.createPage({
          // The server gives each notebook's About me this fixed id.
          id: aboutMePageId(notebookId),
          type: 'aboutme',
          title: 'About me',
          notebookId,
        }),
      );
      await this.router.navigate(['/', notebookId, page.id]);
    } catch (error) {
      console.error('Failed to create About me page:', error);
      await this.dialogService.alert({
        title: 'Could not add About me',
        message:
          'Only members who can edit this notebook can add it. Check your connection and try again.',
      });
    }
  }

  /** Adds the notebook's Graph page (linking starts on the server) and opens it. */
  async createGraphPage(): Promise<void> {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    try {
      const page = await lastValueFrom(
        this.pageService.createPage({
          // The server gives each notebook's Graph this fixed id.
          id: graphPageId(notebookId),
          type: 'graph',
          title: 'Graph',
          notebookId,
        }),
      );
      await this.router.navigate(['/', notebookId, page.id]);
    } catch (error) {
      console.error('Failed to create Graph page:', error);
      await this.dialogService.alert({
        title: 'Could not add Graph',
        message:
          'Only members who can edit this notebook can add it. Check your connection and try again.',
      });
    }
  }

  /** Adds the notebook's Activity page (what bots did and proposed here) and opens it. */
  async createActivityPage(): Promise<void> {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    try {
      const page = await lastValueFrom(
        this.pageService.createPage({
          // The server gives each notebook's Activity this fixed id.
          id: activityPageId(notebookId),
          type: 'activity',
          title: 'Activity',
          notebookId,
        }),
      );
      await this.router.navigate(['/', notebookId, page.id]);
    } catch (error) {
      console.error('Failed to create Activity page:', error);
      await this.dialogService.alert({
        title: 'Could not add Activity',
        message:
          'Only members who can edit this notebook can add it. Check your connection and try again.',
      });
    }
  }

  /** Adds the notebook's Follow-ups page (scanning starts on the server) and opens it. */
  async createFollowUpsPage(): Promise<void> {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return;
    try {
      const page = await lastValueFrom(
        this.pageService.createPage({
          // The server gives each notebook's Follow-ups this fixed id.
          id: followUpsPageId(notebookId),
          type: 'followups',
          title: 'Follow-ups',
          notebookId,
        }),
      );
      await this.router.navigate(['/', notebookId, page.id]);
    } catch (error) {
      console.error('Failed to create Follow-ups page:', error);
      await this.dialogService.alert({
        title: 'Could not add Follow-ups',
        message:
          'Only members who can edit this notebook can add it. Check your connection and try again.',
      });
    }
  }

  toggleNewPageDropdown(event: Event): void {
    event.stopPropagation();
    this.newPageDropdownOpen.update((v) => !v);
  }
}

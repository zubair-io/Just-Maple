import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, switchMap, of, combineLatest, map, catchError, take } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { NotificationService } from '../../services/notification.service';
import { PageService } from '../../services/page.service';
import {
  ShareModalComponent,
  NotebookHeaderComponent,
  ConnectionGraphComponent,
  type GraphNode,
  type GraphEdge,
  type GraphStats,
} from '../../components';
import { getPageTypeLabel as getLabel, getPageTypeIcon as getIcon } from '../../utils/page-types';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import type { NotebookMember, Page } from '@maple/shared';

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
    ShareModalComponent,
    NotebookHeaderComponent,
    ConnectionGraphComponent,
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

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly showShareModal = signal<boolean>(false);
  readonly isEditingName = signal<boolean>(false);
  readonly editingName = signal<string>('');
  private readonly membersRefreshTrigger = signal<number>(0);
  private readonly summaryRefreshTrigger = signal<number>(0);

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
    // Track active notebook for smart notification filtering
    effect(() => {
      const notebookId = this.selectedNotebookId();
      this.notificationService.setActiveNotebook(notebookId);
    });
  }

  // Computed signals reactively derive from store - no validation needed
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

  // Delegate to shared utilities
  getPageTypeLabel = getLabel;
  getPageTypeIcon = getIcon;

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      const notebookId = params['notebookId'] || null;
      this.selectedNotebookId.set(notebookId);

      // For local notebooks, load pages into store
      if (notebookId && isLocalNotebook(notebookId)) {
        this.pageService.loadLocalPages(notebookId).pipe(take(1)).subscribe();
      }
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
}

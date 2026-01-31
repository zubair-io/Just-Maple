import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, switchMap, of, combineLatest, map, catchError } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { NotificationService } from '../../services/notification.service';
import {
  ShareModalComponent,
  NotebookHeaderComponent,
  ConnectionGraphComponent,
  type GraphNode,
  type GraphEdge,
  type GraphStats,
} from '../../components';
import type { NotebookMember } from '@maple/shared';

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
        notebookId ? this.notebookService.fetchNotebookMembers(notebookId) : of([]),
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
        notebookId
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
        notebookId
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

  // Helper to get page type display name
  getPageTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      memo: 'Memos',
      message: 'Messages',
      whiteboard: 'Whiteboards',
      collectable: 'Collectables',
      kanban: 'Kanban Boards',
      recording: 'Recordings',
    };
    return labels[type] || type;
  }

  // Helper to get page type icon
  getPageTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      memo: 'edit_note',
      message: 'chat',
      whiteboard: 'draw',
      collectable: 'grid_view',
      kanban: 'view_kanban',
      recording: 'mic',
    };
    return icons[type] || 'description';
  }

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedNotebookId.set(params['notebookId'] || null);
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

  // Handle graph node click - navigate to the page
  onGraphNodeClicked(pageId: string): void {
    const notebookId = this.selectedNotebookId();
    if (notebookId) {
      this.router.navigate(['/', notebookId, pageId]);
    }
  }
}

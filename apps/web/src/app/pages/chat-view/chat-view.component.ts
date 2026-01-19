import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of, combineLatest } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { MessageService } from '../../services/message.service';
import { NotificationService } from '../../services/notification.service';
import { ChatComponent, ShareModalComponent, NotebookHeaderComponent } from '../../components';
import type { NotebookMember } from '@maple/shared';

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [CommonModule, ChatComponent, ShareModalComponent, NotebookHeaderComponent],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.scss',
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly notebookService = inject(NotebookService);
  private readonly messageService = inject(MessageService);
  private readonly notificationService = inject(NotificationService);

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly showShareModal = signal<boolean>(false);
  private readonly membersRefreshTrigger = signal<number>(0);

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

  constructor() {
    // Track active notebook for smart notification filtering and mark messages as read
    effect(() => {
      const notebookId = this.selectedNotebookId();
      this.notificationService.setActiveNotebook(notebookId);
      if (notebookId) {
        // Mark message notifications as read (for notification bell badge)
        this.notificationService.markNotebookMessagesAsRead(notebookId);
        // Mark messages as read (for per-notebook unread badge)
        this.messageService.markAsRead(notebookId).subscribe();
      }
    });
  }

  // Computed signals reactively derive from store - no validation needed
  readonly selectedNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return null;
    return this.notebookService.notebooks().find((n) => n._id === notebookId) || null;
  });

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedNotebookId.set(params['tagId'] || null);
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
}

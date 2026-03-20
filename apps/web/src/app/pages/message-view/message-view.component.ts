import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of, combineLatest } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { MessageService } from '../../services/message.service';
import { NotificationService } from '../../services/notification.service';
import { PageService } from '../../services/page.service';
import { ShareModalComponent } from '../../components/organisms/share-modal/share-modal.component';
import { NotebookHeaderComponent } from '../../components/molecules/notebook-header/notebook-header.component';
import { ChatComponent } from '../../components/organisms/chat/chat.component';
import { ThreadPanelComponent } from '../../components/organisms/chat/thread-panel/thread-panel.component';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import type { NotebookMember, Message } from '@maple/shared';

@Component({
  selector: 'app-message-view',
  standalone: true,
  imports: [
    CommonModule,
    ShareModalComponent,
    NotebookHeaderComponent,
    ChatComponent,
    ThreadPanelComponent,
  ],
  templateUrl: './message-view.component.html',
  styleUrl: './message-view.component.scss',
})
export class MessageViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly notebookService = inject(NotebookService);
  private readonly messageService = inject(MessageService);
  private readonly notificationService = inject(NotificationService);
  private readonly pageService = inject(PageService);

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly selectedPageId = signal<string | null>(null);
  readonly showShareModal = signal<boolean>(false);
  readonly activeThreadMessage = signal<Message | null>(null);
  private readonly membersRefreshTrigger = signal<number>(0);

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

  constructor() {
    // Track active notebook for smart notification filtering and mark messages as read
    effect(() => {
      const notebookId = this.selectedNotebookId();
      const pageId = this.selectedPageId();
      this.notificationService.setActiveNotebook(notebookId);
      if (pageId) {
        // Load messages for this page
        this.messageService.loadMessagesByPageId(pageId).subscribe();
        // Mark messages as read
        this.messageService.markAsReadByPageId(pageId).subscribe();
      }
    });
  }

  // Computed signals reactively derive from store
  readonly selectedNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return null;
    return this.notebookService.notebooks().find((n) => n._id === notebookId) || null;
  });

  readonly selectedPage = computed(() => {
    const pageId = this.selectedPageId();
    if (!pageId) return null;
    return this.pageService.pages().find((p) => p.id === pageId) || null;
  });

  ngOnInit(): void {
    // Subscribe to route params
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedNotebookId.set(params['notebookId'] || null);
      this.selectedPageId.set(params['id'] || null);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    // Clear active notebook when leaving
    this.notificationService.setActiveNotebook(null);
    this.messageService.clearMessages();
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

  openThread(message: Message): void {
    this.activeThreadMessage.set(message);
  }

  closeThread(): void {
    this.activeThreadMessage.set(null);
  }
}

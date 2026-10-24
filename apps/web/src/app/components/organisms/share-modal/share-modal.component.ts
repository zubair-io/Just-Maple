import {
  Component,
  input,
  output,
  signal,
  inject,
  effect,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { combineLatest, switchMap, of, tap, catchError } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { ProfileAvatarComponent } from '../../atoms';
import { DialogService } from '../../molecules';
import { NotebookService } from '../../../services/notebook.service';
import { BotService, type EnrichedUserBot } from '../../../services/bot.service';
import { isLocalNotebook } from '../../../providers/data-provider.interface';
import type { NotebookMember, Notebook, Page } from '@maple/shared';
import { AuthService } from '../../../services/auth.service';
import { ProactiveBotService } from '../../../services/proactive-bot.service';
import { ProactiveBotPanelComponent } from '../proactive-bot-panel/proactive-bot-panel.component';
import { toDisplaySlug } from '@maple/shared/utils/slug';

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent, ProactiveBotPanelComponent],
  templateUrl: './share-modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './share-modal.component.scss',
})
export class ShareModalComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly notebookService = inject(NotebookService);
  private readonly botService = inject(BotService);
  private readonly dialogService = inject(DialogService);
  private readonly authService = inject(AuthService);

  readonly notebook = input.required<Notebook>();
  readonly members = input.required<NotebookMember[]>();
  /** The notebook's chats (messages pages); each can have one proactive bot. */
  readonly chatPages = input<Page[]>([]);
  /** The chat open behind the dialog, preselected for the proactive bot. */
  readonly currentChatId = input<string | null>(null);
  readonly closed = output<void>();
  readonly membersChanged = output<void>();

  readonly accountIdInput = signal('');
  readonly isSharing = signal(false);
  readonly shareError = signal<string | null>(null);
  readonly selectedAccessLevel = signal<'read' | 'write'>('write');

  // Bot sharing state
  readonly userBots = this.botService.userBots;
  readonly showAddBotDialog = signal(false);
  readonly isLoadingBots = signal(false);
  private readonly sharedBotsRefreshTrigger = signal<number>(0);

  readonly isTogglingPublic = signal(false);

  // Proactive bots: any of your AI bots shared here can be a chat's proactive bot
  private readonly proactiveService = inject(ProactiveBotService);
  private readonly pickedChatId = signal<string | null>(null);
  readonly expandedBotId = signal<string | null>(null);
  readonly proactiveBusy = signal(false);
  readonly selectedChat = computed(() => {
    const chats = this.chatPages();
    const id = this.pickedChatId() ?? this.currentChatId();
    return chats.find((page) => page.id === id) ?? chats[0] ?? null;
  });

  /** Your own built-in AI bots; webhook bots never get Mac data. */
  canBeProactive(bot: EnrichedUserBot): boolean {
    return (
      bot.userId === this.authService.user()?._id && bot.botType !== 'custom' && !!bot.templateId
    );
  }

  isProactive(bot: EnrichedUserBot): boolean {
    const proactive = this.selectedChat()?.proactive;
    return !!proactive?.enabled && proactive.userBotId === bot._id;
  }

  /** On: open its instructions to confirm. Off: turn it off right away. */
  async toggleProactive(bot: EnrichedUserBot): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) return;
    if (!this.isProactive(bot)) {
      this.expandedBotId.set(this.expandedBotId() === bot._id ? null : bot._id);
      return;
    }
    this.proactiveBusy.set(true);
    try {
      await this.proactiveService.remove(chat.id);
      this.expandedBotId.set(null);
    } finally {
      this.proactiveBusy.set(false);
    }
  }

  selectChat(id: string): void {
    this.pickedChatId.set(id);
    this.expandedBotId.set(null);
  }

  readonly notebookId = computed(() => this.notebook()?._id);
  readonly isLocal = computed(() => isLocalNotebook(this.notebook()?._id ?? ''));
  readonly isPublic = computed(() => !!this.notebook()?.sharing?.isPublic);
  readonly publicUrl = computed(() => {
    const nb = this.notebook();
    if (!this.isPublic() || !nb?.slug) return null;
    return `${window.location.origin}/!/${toDisplaySlug(nb.label, nb.slug)}`;
  });
  readonly linkCopied = signal(false);

  // Reactively load shared bots when notebook changes or refresh is triggered
  readonly sharedBots = toSignal(
    combineLatest([
      toObservable(this.notebookId),
      toObservable(this.sharedBotsRefreshTrigger),
    ]).pipe(
      tap(() => this.isLoadingBots.set(true)),
      switchMap(([notebookId, _trigger]) =>
        notebookId
          ? this.botService.getNotebookSharedBots(notebookId).pipe(
              tap(() => this.isLoadingBots.set(false)),
              catchError((err) => {
                console.error('Failed to load shared bots:', err);
                this.isLoadingBots.set(false);
                return of([]);
              }),
            )
          : of([]),
      ),
    ),
    { initialValue: [] as EnrichedUserBot[] },
  );

  constructor() {
    // Ensure user bots are loaded for the bot sharing tab
    if (this.botService.userBots().length === 0) {
      this.botService.loadUserBots().subscribe();
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  async shareNotebook(): Promise<void> {
    const userId = this.accountIdInput().trim();
    if (!userId) return;

    this.isSharing.set(true);
    this.shareError.set(null);

    this.notebookService
      .shareNotebook(this.notebook()._id, userId, this.selectedAccessLevel())
      .subscribe({
        next: () => {
          this.accountIdInput.set('');
          this.isSharing.set(false);
          this.membersChanged.emit();
        },
        error: (err) => {
          this.shareError.set(err.message);
          this.isSharing.set(false);
        },
      });
  }

  async removeMember(userId: string): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Remove Member',
      message: 'Are you sure you want to remove this user from the notebook?',
      confirmLabel: 'Remove',
    });
    if (!confirmed) {
      return;
    }

    this.notebookService.unshareNotebook(this.notebook()._id, userId).subscribe({
      next: () => {
        this.membersChanged.emit();
      },
      error: (err) => {
        console.error('Failed to remove member:', err);
        this.dialogService.alert({
          title: 'Error',
          message: 'Failed to remove member: ' + err.message,
        });
      },
    });
  }

  getAccessLevelLabel(level: string): string {
    return level === 'owner' ? 'Owner' : level === 'write' ? 'Can edit' : 'Can view';
  }

  // Bot sharing methods
  async addBot(userBotId: string): Promise<void> {
    this.botService.shareBotToNotebook(this.notebook()._id, userBotId).subscribe({
      next: () => {
        this.showAddBotDialog.set(false);
        // Trigger refresh of shared bots
        this.sharedBotsRefreshTrigger.update((n) => n + 1);
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: 'Failed to add bot: ' + err.message,
        });
      },
    });
  }

  async removeBot(userBotId: string, botHandle: string): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Remove Bot',
      message: `Remove @${botHandle} from this notebook?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) {
      return;
    }

    this.botService.unshareBotFromNotebook(this.notebook()._id, userBotId).subscribe({
      next: () => {
        // Trigger refresh of shared bots
        this.sharedBotsRefreshTrigger.update((n) => n + 1);
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: 'Failed to remove bot: ' + err.message,
        });
      },
    });
  }

  copyPublicLink(): void {
    const url = this.publicUrl();
    if (!url) return;
    if (this.clipboard.copy(url)) {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    }
  }

  togglePublic(): void {
    const notebook = this.notebook();
    const newValue = !this.isPublic();
    this.isTogglingPublic.set(true);

    let call;
    if (newValue) {
      // Always use PATCH when turning ON — it triggers bulkPublishPagesForNotebook on the backend
      // Slug is auto-generated by the backend to ensure uniqueness
      call = this.notebookService.updatePublicConfig(notebook._id, { isPublic: true });
    } else {
      call = this.notebookService.setPublic(notebook._id, false);
    }

    call.subscribe({
      next: () => {
        this.isTogglingPublic.set(false);
        this.membersChanged.emit();
      },
      error: (err) => {
        this.isTogglingPublic.set(false);
        console.error('Failed to toggle public access:', err);
        this.dialogService.alert({
          title: 'Error',
          message: 'Failed to update public access: ' + err.message,
        });
      },
    });
  }

  isOwner(): boolean {
    // For local notebooks, the user is always the owner
    if (this.isLocal()) return true;
    const currentUser = this.members().find((m) => m.accessLevel === 'owner');
    return !!currentUser; // Simplified - in real app, check if current user is owner
  }
}

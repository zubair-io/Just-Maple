import { Component, input, output, signal, inject, effect, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { combineLatest, switchMap, of, tap, catchError } from 'rxjs';
import { ProfileAvatarComponent } from '../../atoms';
import { DialogService } from '../../molecules';
import { NotebookService } from '../../../services/notebook.service';
import { BotService, type EnrichedUserBot } from '../../../services/bot.service';
import { isLocalNotebook } from '../../../providers/data-provider.interface';
import type { NotebookMember, Notebook } from '@maple/shared';

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent],
  templateUrl: './share-modal.component.html',
  styleUrl: './share-modal.component.scss',
})
export class ShareModalComponent {
  private readonly notebookService = inject(NotebookService);
  private readonly botService = inject(BotService);
  private readonly dialogService = inject(DialogService);

  readonly notebook = input.required<Notebook>();
  readonly members = input.required<NotebookMember[]>();
  readonly closed = output<void>();
  readonly membersChanged = output<void>();

  readonly emailInput = signal('');
  readonly isSharing = signal(false);
  readonly shareError = signal<string | null>(null);
  readonly selectedAccessLevel = signal<'read' | 'write'>('write');

  // Bot sharing state
  readonly userBots = this.botService.userBots;
  readonly showAddBotDialog = signal(false);
  readonly isLoadingBots = signal(false);
  private readonly sharedBotsRefreshTrigger = signal<number>(0);

  readonly isTogglingPublic = signal(false);

  readonly notebookId = computed(() => this.notebook()?._id);
  readonly isLocal = computed(() => isLocalNotebook(this.notebook()?._id ?? ''));
  readonly isPublic = computed(() => !!this.notebook()?.sharing?.isPublic);
  readonly publicUrl = computed(() => {
    const slug = this.notebook()?.slug;
    if (!this.isPublic() || !slug) return null;
    return `${window.location.origin}/!/${slug}`;
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
    const email = this.emailInput().trim();
    if (!email) return;

    this.isSharing.set(true);
    this.shareError.set(null);

    this.notebookService
      .shareNotebook(this.notebook()._id, email, this.selectedAccessLevel())
      .subscribe({
        next: () => {
          this.emailInput.set('');
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
    navigator.clipboard.writeText(url).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    });
  }

  togglePublic(): void {
    const notebook = this.notebook();
    const newValue = !this.isPublic();
    this.isTogglingPublic.set(true);

    let call;
    if (newValue) {
      // Always use PATCH when turning ON — it triggers bulkPublishPagesForNotebook on the backend
      const slug =
        notebook.slug ||
        notebook.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') +
          '-' +
          Math.random().toString(16).slice(2, 8);
      call = this.notebookService.updatePublicConfig(notebook._id, { isPublic: true, slug });
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

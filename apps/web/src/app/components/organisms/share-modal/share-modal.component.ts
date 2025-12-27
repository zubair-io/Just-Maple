import { Component, input, output, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileAvatarComponent } from '../../atoms';
import { TagService } from '../../../services/tag.service';
import { BotService, type EnrichedUserBot } from '../../../services/bot.service';
import type { TagMember, Tag } from '@maple/shared';

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent],
  templateUrl: './share-modal.component.html',
  styleUrl: './share-modal.component.scss',
})
export class ShareModalComponent {
  private readonly tagService = inject(TagService);
  private readonly botService = inject(BotService);

  readonly tag = input.required<Tag>();
  readonly members = input.required<TagMember[]>();
  readonly closed = output<void>();
  readonly membersChanged = output<void>();

  readonly emailInput = signal('');
  readonly isSharing = signal(false);
  readonly shareError = signal<string | null>(null);
  readonly selectedAccessLevel = signal<'read' | 'write'>('write');

  // Bot sharing state
  readonly sharedBots = signal<EnrichedUserBot[]>([]);
  readonly userBots = this.botService.userBots;
  readonly showAddBotDialog = signal(false);
  readonly isLoadingBots = signal(false);

  constructor() {
    // Load shared bots when tag changes
    effect(() => {
      const tagId = this.tag()?._id;
      if (tagId) {
        this.loadSharedBots(tagId);
      }
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  async shareTag(): Promise<void> {
    const email = this.emailInput().trim();
    if (!email) return;

    this.isSharing.set(true);
    this.shareError.set(null);

    this.tagService.shareTag(this.tag()._id, email, this.selectedAccessLevel()).subscribe({
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
    if (!confirm('Are you sure you want to remove this user from the tag?')) {
      return;
    }

    this.tagService.unshareTag(this.tag()._id, userId).subscribe({
      next: () => {
        this.membersChanged.emit();
      },
      error: (err) => {
        console.error('Failed to remove member:', err);
        alert('Failed to remove member: ' + err.message);
      },
    });
  }

  getAccessLevelLabel(level: string): string {
    return level === 'owner' ? 'Owner' : level === 'write' ? 'Can edit' : 'Can view';
  }

  // Bot sharing methods
  private loadSharedBots(tagId: string): void {
    this.isLoadingBots.set(true);
    this.botService.getTagSharedBots(tagId).subscribe({
      next: (bots) => {
        this.sharedBots.set(bots);
        this.isLoadingBots.set(false);
      },
      error: (err) => {
        console.error('Failed to load shared bots:', err);
        this.isLoadingBots.set(false);
      },
    });
  }

  async addBot(userBotId: string): Promise<void> {
    this.botService.shareBotToTag(this.tag()._id, userBotId).subscribe({
      next: () => {
        this.showAddBotDialog.set(false);
        this.loadSharedBots(this.tag()._id);
      },
      error: (err) => {
        alert('Failed to add bot: ' + err.message);
      },
    });
  }

  async removeBot(userBotId: string, botHandle: string): Promise<void> {
    if (!confirm(`Remove @${botHandle} from this tag?`)) {
      return;
    }

    this.botService.unshareBotFromTag(this.tag()._id, userBotId).subscribe({
      next: () => {
        this.loadSharedBots(this.tag()._id);
      },
      error: (err) => {
        alert('Failed to remove bot: ' + err.message);
      },
    });
  }

  isOwner(): boolean {
    const currentUser = this.members().find((m) => m.accessLevel === 'owner');
    return !!currentUser; // Simplified - in real app, check if current user is owner
  }
}

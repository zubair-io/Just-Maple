import { Component, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileAvatarComponent } from '../../atoms';
import { TagService } from '../../../services/tag.service';
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

  readonly tag = input.required<Tag>();
  readonly members = input.required<TagMember[]>();
  readonly closed = output<void>();
  readonly membersChanged = output<void>();

  readonly emailInput = signal('');
  readonly isSharing = signal(false);
  readonly shareError = signal<string | null>(null);
  readonly selectedAccessLevel = signal<'read' | 'write'>('write');

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
}

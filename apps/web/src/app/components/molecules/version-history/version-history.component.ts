import { Component, input, output, signal, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MemoVersionService } from '../../../services/memo-version.service';
import type { MemoVersionListItem, VersionTrigger } from '@maple/shared';

@Component({
  selector: 'app-version-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './version-history.component.html',
  styleUrl: './version-history.component.scss',
})
export class VersionHistoryComponent {
  private readonly versionService = inject(MemoVersionService);

  readonly noteId = input.required<string>();
  readonly isOpen = input<boolean>(false);

  readonly close = output<void>();
  readonly restored = output<void>();

  readonly versions = signal<MemoVersionListItem[]>([]);
  readonly isLoading = signal(false);
  readonly isRestoring = signal(false);
  readonly hasMore = signal(false);
  readonly selectedVersionId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly selectedVersion = computed(() => {
    const id = this.selectedVersionId();
    if (!id) return null;
    return this.versions().find((v) => v._id === id) ?? null;
  });

  constructor() {
    effect(() => {
      const noteId = this.noteId();
      const open = this.isOpen();
      if (open && noteId) {
        this.loadVersions();
      }
    });
  }

  loadVersions(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.versionService.getVersions(this.noteId()).subscribe({
      next: (response) => {
        this.versions.set(response.versions);
        this.hasMore.set(response.hasMore);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load versions:', err);
        this.error.set('Failed to load version history');
        this.isLoading.set(false);
      },
    });
  }

  loadMore(): void {
    const currentVersions = this.versions();
    if (currentVersions.length === 0 || !this.hasMore()) return;

    const oldestVersion = currentVersions[currentVersions.length - 1];
    const before = new Date(oldestVersion.createdAt);

    this.isLoading.set(true);

    this.versionService.getVersions(this.noteId(), 20, before).subscribe({
      next: (response) => {
        this.versions.update((v) => [...v, ...response.versions]);
        this.hasMore.set(response.hasMore);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  selectVersion(versionId: string): void {
    this.selectedVersionId.set(versionId === this.selectedVersionId() ? null : versionId);
  }

  restoreVersion(): void {
    const versionId = this.selectedVersionId();
    if (!versionId || this.isRestoring()) return;

    this.isRestoring.set(true);

    this.versionService.restoreVersion(this.noteId(), versionId).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.restored.emit();
        this.close.emit();
      },
      error: (err) => {
        console.error('Failed to restore version:', err);
        this.error.set('Failed to restore version');
        this.isRestoring.set(false);
      },
    });
  }

  formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  formatTrigger(trigger: VersionTrigger): string {
    switch (trigger) {
      case 'auto-interval':
        return 'Auto-save';
      case 'auto-idle':
        return 'Auto-save';
      case 'manual':
        return 'Checkpoint';
      case 'ai-edit':
        return 'Before AI edit';
      case 'significant-change':
        return 'Major change';
      case 'import':
        return 'Import';
      default:
        return 'Auto-save';
    }
  }

  getTriggerIcon(trigger: VersionTrigger): string {
    switch (trigger) {
      case 'manual':
        return 'bookmark';
      case 'ai-edit':
        return 'smart_toy';
      case 'significant-change':
        return 'edit_note';
      case 'import':
        return 'upload';
      default:
        return 'schedule';
    }
  }
}

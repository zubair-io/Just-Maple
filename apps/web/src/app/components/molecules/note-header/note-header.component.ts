import { Component, input, output, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Page, Notebook } from '@maple/shared';
import { SyncStatusComponent } from '../../atoms/sync-status/sync-status.component';
import { VersionHistoryComponent } from '../version-history/version-history.component';
import { UiStateService } from '../../../services/ui-state.service';

export type ExportFormat = 'markdown' | 'html';

@Component({
  selector: 'app-note-header',
  standalone: true,
  imports: [CommonModule, FormsModule, SyncStatusComponent, VersionHistoryComponent],
  templateUrl: './note-header.component.html',
  styleUrl: './note-header.component.scss',
})
export class NoteHeaderComponent {
  private readonly uiStateService = inject(UiStateService);

  readonly page = input<Page | null>(null);
  readonly notebook = input<Notebook | null>(null);

  // Editor state inputs
  readonly canUndo = input<boolean>(false);
  readonly canRedo = input<boolean>(false);
  readonly isFullWidth = input<boolean>(false);
  readonly pageId = input<string>('');

  readonly toggleFavorite = output<void>();
  readonly exportRequested = output<ExportFormat>();
  readonly undoRequested = output<void>();
  readonly redoRequested = output<void>();
  readonly toggleWidthRequested = output<void>();
  readonly versionRestored = output<void>();
  readonly deleteRequested = output<void>();
  readonly titleChanged = output<string>();
  readonly publishToggled = output<boolean>();

  // Publish state
  readonly contentDirty = input<boolean>(false);
  readonly isNotebookPublic = computed(() => !!this.notebook()?.sharing?.isPublic);
  readonly isPagePublished = computed(() => !!this.page()?.isPublished);
  readonly isPublishStale = computed(() => {
    if (!this.isPagePublished()) return false;
    return this.contentDirty();
  });

  readonly showExportMenu = signal(false);
  readonly showVersionHistory = signal(false);
  readonly isEditingTitle = signal(false);
  readonly editTitleValue = signal('');

  openSidebarOnMobile(): void {
    this.uiStateService.openSidebar();
  }

  startEditingTitle(): void {
    const title = this.page()?.title || '';
    this.editTitleValue.set(title);
    this.isEditingTitle.set(true);
  }

  saveTitle(): void {
    const newTitle = this.editTitleValue().trim();
    this.isEditingTitle.set(false);
    if (newTitle && newTitle !== this.page()?.title) {
      this.titleChanged.emit(newTitle);
    }
  }

  cancelEditingTitle(): void {
    this.isEditingTitle.set(false);
  }

  readonly formattedDate = computed(() => {
    const page = this.page();
    if (!page?.updatedAt) return '';
    return this.formatDateValue(page.updatedAt);
  });

  toggleExportMenu(): void {
    this.showExportMenu.update((v) => !v);
  }

  closeExportMenu(): void {
    this.showExportMenu.set(false);
  }

  exportAs(format: ExportFormat): void {
    this.exportRequested.emit(format);
    this.closeExportMenu();
  }

  toggleVersionHistory(): void {
    this.showVersionHistory.update((v) => !v);
  }

  closeVersionHistory(): void {
    this.showVersionHistory.set(false);
  }

  onVersionRestored(): void {
    this.versionRestored.emit();
  }

  private formatDateValue(dateString: string): string {
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
}

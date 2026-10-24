import {
  Component,
  input,
  output,
  computed,
  signal,
  inject,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Page, Notebook } from '@maple/shared';
import { toDisplaySlug } from '@maple/shared/utils/slug';
import { Clipboard } from '@angular/cdk/clipboard';
import { VersionHistoryComponent } from '../version-history/version-history.component';
import { UiStateService } from '../../../services/ui-state.service';

export type ExportFormat = 'markdown' | 'html';

@Component({
  selector: 'app-note-header',
  standalone: true,
  imports: [CommonModule, FormsModule, VersionHistoryComponent, RouterLink],
  templateUrl: './note-header.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './note-header.component.scss',
})
export class NoteHeaderComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly uiStateService = inject(UiStateService);

  readonly page = input<Page | null>(null);
  readonly notebook = input<Notebook | null>(null);
  readonly showDetails = input(true);
  readonly showControls = input(true);

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

  readonly showPublishModal = signal(false);
  readonly isTogglingPublish = signal(false);
  readonly linkCopied = signal(false);
  readonly publicPageUrl = computed(() => {
    const nb = this.notebook();
    const pg = this.page();
    if (!nb?.slug || !pg?.publishedSlug) return null;
    const nbSlug = toDisplaySlug(nb.label, nb.slug);
    const pgSlug = toDisplaySlug(pg.title, pg.publishedSlug);
    return `${window.location.origin}/!/${nbSlug}/${pgSlug}`;
  });

  readonly showExportMenu = signal(false);
  readonly showVersionHistory = signal(false);
  readonly isEditingTitle = signal(false);
  readonly editTitleValue = signal('');

  constructor() {
    effect(() => {
      const title = this.page()?.title || '';
      this.editTitleValue.set(title);
    });
  }

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

  openPublishModal(): void {
    this.showPublishModal.set(true);
  }

  closePublishModal(): void {
    this.showPublishModal.set(false);
  }

  onPublishToggle(): void {
    this.isTogglingPublish.set(true);
    this.publishToggled.emit(!this.isPagePublished());
    // Parent will update the page; reset after a short delay
    setTimeout(() => this.isTogglingPublish.set(false), 1500);
  }

  onRepublish(): void {
    this.isTogglingPublish.set(true);
    this.publishToggled.emit(true);
    setTimeout(() => this.isTogglingPublish.set(false), 1500);
  }

  copyPublicLink(): void {
    const url = this.publicPageUrl();
    if (!url) return;
    if (this.clipboard.copy(url)) {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    }
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

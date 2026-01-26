import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Page, Notebook } from '@maple/shared';
import { NewPageButtonComponent } from '../../atoms/new-page-button/new-page-button.component';

export type ExportFormat = 'markdown' | 'html';

@Component({
  selector: 'app-note-header',
  standalone: true,
  imports: [CommonModule, NewPageButtonComponent],
  templateUrl: './note-header.component.html',
  styleUrl: './note-header.component.scss',
})
export class NoteHeaderComponent {
  readonly page = input<Page | null>(null);
  readonly notebook = input<Notebook | null>(null);

  readonly toggleFavorite = output<void>();
  readonly exportRequested = output<ExportFormat>();

  readonly showExportMenu = signal(false);

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

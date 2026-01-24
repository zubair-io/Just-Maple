import {
  Component,
  input,
  inject,
  signal,
  effect,
  ChangeDetectionStrategy,
  output,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PageService } from '../../../services/page.service';
import type { Page } from '@maple/shared';

@Component({
  selector: 'app-memo-embed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './memo-embed.component.html',
  styleUrl: './memo-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoEmbedComponent {
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly documentId = input.required<string>();

  readonly deleteRequested = output<string>();

  readonly page = signal<Page | null>(null);
  readonly isLoading = signal(true);

  constructor() {
    effect(() => {
      const id = this.documentId();
      if (id) {
        this.loadPage(id);
      }
    });
  }

  private loadPage(documentId: string): void {
    this.isLoading.set(true);
    this.pageService
      .select(documentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  /**
   * Extract preview text from page content
   */
  readonly previewText = computed(() => {
    const p = this.page();
    if (!p?.content || !p.content.content) return '';

    // Extract text from first few content blocks (skip title heading)
    const textParts: string[] = [];
    let charCount = 0;
    const maxChars = 150;

    for (const block of p.content.content.slice(1)) {
      if (charCount >= maxChars) break;

      if (block.content) {
        for (const inline of block.content) {
          if (inline.text) {
            textParts.push(inline.text);
            charCount += inline.text.length;
          }
        }
      }
    }

    const text = textParts.join(' ').trim();
    if (text.length > maxChars) {
      return text.substring(0, maxChars) + '...';
    }
    return text;
  });

  /**
   * Navigate to the full memo view
   */
  openMemo(): void {
    const p = this.page();
    if (p?.notebookId) {
      this.router.navigate(['/', p.notebookId, p.id]);
    }
  }

  /**
   * Handle delete request
   */
  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteRequested.emit(this.documentId());
  }
}

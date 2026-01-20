import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PageService } from '../../services/page.service';
import { MemoDocumentService } from '../../services/memo-document.service';
import { WhiteboardDocumentService } from '../../services/whiteboard-document.service';
import type { PageType } from '@maple/shared';

@Component({
  selector: 'app-new-note',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center h-full">
      <div class="text-[var(--color-text-muted)]">Creating page...</div>
    </div>
  `,
})
export class NewNoteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly memoService = inject(MemoDocumentService);
  private readonly whiteboardService = inject(WhiteboardDocumentService);

  ngOnInit(): void {
    const notebookId = this.route.snapshot.paramMap.get('tagId');
    const type = (this.route.snapshot.queryParamMap.get('type') as PageType) || 'memo';

    this.createPage(notebookId, type);
  }

  private async createPage(notebookId: string | null, type: PageType): Promise<void> {
    try {
      if (type === 'memo') {
        // Create memo using the offline-first memo service
        const { page } = await this.memoService.createMemo(notebookId || undefined);
        this.router.navigate(['/', notebookId, page.documentId], { replaceUrl: true });
      } else if (type === 'whiteboard') {
        // Create whiteboard using the offline-first whiteboard service
        const { page } = await this.whiteboardService.createWhiteboard(notebookId || undefined);
        this.router.navigate(['/', notebookId, page.documentId], { replaceUrl: true });
      } else {
        // Create other page types using the regular page service
        this.pageService
          .createPage({
            title: 'Untitled',
            content: { type: 'doc', content: [] },
            tagId: notebookId || undefined,
            type,
          })
          .subscribe({
            next: (page) => {
              this.router.navigate(['/', notebookId, page.documentId], { replaceUrl: true });
            },
            error: (err) => {
              console.error('Failed to create page:', err);
              this.router.navigate(['/', notebookId], { replaceUrl: true });
            },
          });
      }
    } catch (err) {
      console.error('Failed to create page:', err);
      this.router.navigate(['/', notebookId], { replaceUrl: true });
    }
  }
}

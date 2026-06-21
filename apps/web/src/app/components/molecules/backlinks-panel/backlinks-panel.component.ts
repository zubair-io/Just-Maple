import { Component, effect, inject, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { LinkService } from '../../../services/link.service';
import type { PageLink, UnlinkedMention } from '@maple/shared';

@Component({
  selector: 'app-backlinks-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backlinks-panel.component.html',
  styleUrl: './backlinks-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BacklinksPanelComponent {
  private readonly linkService = inject(LinkService);
  private readonly router = inject(Router);

  readonly pageId = input.required<string>();
  readonly notebookId = input.required<string>();

  readonly backlinks = signal<PageLink[]>([]);
  readonly unlinkedMentions = signal<UnlinkedMention[]>([]);
  readonly isExpanded = signal(true);
  readonly showUnlinked = signal(false);
  readonly isLoading = signal(false);

  constructor() {
    effect(() => {
      const id = this.pageId();
      if (id) {
        this.loadBacklinks(id);
      }
    });
  }

  private loadBacklinks(pageId: string): void {
    this.isLoading.set(true);

    forkJoin({
      backlinks: this.linkService.getBacklinks(pageId),
      mentions: this.linkService.getUnlinkedMentions(pageId, this.notebookId()),
    }).subscribe({
      next: ({ backlinks, mentions }) => {
        this.backlinks.set(backlinks);
        this.unlinkedMentions.set(mentions);
        this.isLoading.set(false);
      },
      error: () => {
        this.backlinks.set([]);
        this.unlinkedMentions.set([]);
        this.isLoading.set(false);
      },
    });
  }

  navigateToPage(linkPageId: string): void {
    this.router.navigate(['/', this.notebookId(), linkPageId]);
  }

  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  toggleUnlinked(): void {
    this.showUnlinked.update((v) => !v);
  }

  getLinkIcon(type: string): string {
    switch (type) {
      case 'inline':
        return 'link';
      case 'block':
        return 'article';
      case 'tag':
        return 'tag';
      default:
        return 'link';
    }
  }
}

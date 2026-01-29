import { Component, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { PageLink, UnlinkedMention } from '@maple/shared';

@Component({
  selector: 'app-backlinks-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backlinks-panel.component.html',
  styleUrl: './backlinks-panel.component.scss',
})
export class BacklinksPanelComponent {
  private readonly http = inject(HttpClient);
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

  private async loadBacklinks(pageId: string): Promise<void> {
    this.isLoading.set(true);

    try {
      const [backlinksRes, unlinkedRes] = await Promise.all([
        firstValueFrom(this.http.get<{ backlinks: PageLink[] }>(`/api/links/${pageId}/backlinks`)),
        firstValueFrom(
          this.http.get<{ mentions: UnlinkedMention[] }>(`/api/links/${pageId}/unlinked`, {
            params: { notebookId: this.notebookId() },
          }),
        ),
      ]);

      this.backlinks.set(backlinksRes.backlinks);
      this.unlinkedMentions.set(unlinkedRes.mentions);
    } catch (error) {
      console.error('Failed to load backlinks:', error);
      this.backlinks.set([]);
      this.unlinkedMentions.set([]);
    } finally {
      this.isLoading.set(false);
    }
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

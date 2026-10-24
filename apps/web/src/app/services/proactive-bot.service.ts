import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { MacDataSource, Page, UpdateProactiveBotInput } from '@maple/shared';
import { PageService } from './page.service';

export interface MacDataHostStatus {
  online: boolean;
  lastSeenAt?: string;
  timeZone?: string;
  /** Sources this notebook has Mac pages for, on the signed-in user's Mac. */
  sources: MacDataSource[];
}

/**
 * A messages page's proactive bot: the one bot that answers every message there and
 * posts on its own when new iMessage, Mail or Calendar data arrives on the user's Mac.
 */
@Injectable({ providedIn: 'root' })
export class ProactiveBotService {
  private readonly http = inject(HttpClient);
  private readonly pageService = inject(PageService);

  async save(pageId: string, input: UpdateProactiveBotInput): Promise<Page> {
    const { page } = await firstValueFrom(
      this.http.put<{ page: Page }>(`/api/pages/${pageId}/proactive`, input),
    );
    await this.refresh(pageId);
    return page;
  }

  async remove(pageId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/pages/${pageId}/proactive`));
    await this.refresh(pageId);
  }

  status(notebookId: string): Promise<MacDataHostStatus> {
    return firstValueFrom(
      this.http.get<MacDataHostStatus>('/api/mac-data/status', { params: { notebookId } }),
    );
  }

  /** Reload the page so the store (and every view of it) sees the new setting. */
  private async refresh(pageId: string): Promise<void> {
    await firstValueFrom(this.pageService.getPage(pageId)).catch(() => undefined);
  }
}

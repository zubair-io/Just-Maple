import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AssistanceConversation,
  AssistanceHistory,
  AssistanceTask,
  TodayFeed,
  TodaySection,
  Page,
  FollowUpAction,
} from '@maple/shared';
import { BotActionService } from './bot-action.service';

@Injectable({ providedIn: 'root' })
export class AssistanceService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(BotActionService);
  async bots(notebookId: string): Promise<{ id: string; name: string; handle: string }[]> {
    return (
      await firstValueFrom(
        this.http.get<{ bots: { id: string; name: string; handle: string }[] }>(
          `/api/assistance/bots/${notebookId}`,
        ),
      )
    ).bots;
  }
  async open(pageId: string, botId: string): Promise<AssistanceConversation> {
    return (
      await firstValueFrom(
        this.http.post<{ conversation: AssistanceConversation }>('/api/assistance/conversations', {
          pageId,
          botId,
        }),
      )
    ).conversation;
  }
  history(id: string, before?: string): Promise<AssistanceHistory> {
    return firstValueFrom(
      this.http.get<AssistanceHistory>(`/api/assistance/conversations/${id}`, {
        params: before ? new HttpParams().set('before', before) : undefined,
      }),
    );
  }
  async send(
    id: string,
    requestId: string,
    text: string,
    selection?: string,
  ): Promise<AssistanceTask> {
    return (
      await firstValueFrom(
        this.http.post<{ task: AssistanceTask }>(`/api/assistance/conversations/${id}/messages`, {
          requestId,
          text,
          ...(selection ? { selection } : {}),
        }),
      )
    ).task;
  }
  async saveDraft(id: string, text: string, version: number): Promise<AssistanceConversation> {
    return (
      await firstValueFrom(
        this.http.patch<{ conversation: AssistanceConversation }>(
          `/api/assistance/conversations/${id}/draft`,
          { text, version },
        ),
      )
    ).conversation;
  }
  async stop(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/assistance/tasks/${id}/stop`, {}));
  }
  async saveResult(id: string, title: string, notebookId: string): Promise<Page> {
    return (
      await firstValueFrom(
        this.http.post<{ page: Page }>(`/api/assistance/tasks/${id}/save`, { title, notebookId }),
      )
    ).page;
  }
  async today(
    notebookId: string,
    section: TodaySection,
    cursors: Record<string, string> = {},
  ): Promise<TodayFeed> {
    let params = new HttpParams().set('section', section).set('limit', 20);
    for (const [key, value] of Object.entries(cursors)) if (value) params = params.set(key, value);
    const feed = await firstValueFrom(
      this.http.get<TodayFeed>(`/api/assistance/today/${notebookId}`, { params }),
    );
    this.actions.remember(feed.actions);
    return feed;
  }
  async followUp(
    notebookId: string,
    id: string,
    action: FollowUpAction,
    until?: string,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch(`/api/follow-ups/${notebookId}/${encodeURIComponent(id)}`, {
        action,
        ...(until ? { until } : {}),
      }),
    );
  }
  prepare(
    notebookId: string,
    followUpId: string,
    botId: string,
    requestId: string,
  ): Promise<{ conversation: AssistanceConversation; task: AssistanceTask }> {
    return firstValueFrom(
      this.http.post<{ conversation: AssistanceConversation; task: AssistanceTask }>(
        `/api/assistance/today/${notebookId}/draft`,
        { followUpId, botId, requestId },
      ),
    );
  }
}
export function assistanceError(error: unknown): string {
  return (
    (error as { error?: { message?: string }; message?: string })?.error?.message ||
    (error as Error)?.message ||
    'Could not finish the request. Try again.'
  );
}

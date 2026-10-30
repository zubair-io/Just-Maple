import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  MessageArchiveProgress,
  MessageDirectory,
  MessageHistoryPage,
  MessageHistoryQuery,
} from '@maple/shared';
import { OwnerOnlyError } from './device-data.service';

@Injectable({ providedIn: 'root' })
export class MessageHistoryService {
  private readonly http = inject(HttpClient);
  private params(query: MessageHistoryQuery) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    return params;
  }
  private async request<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 403 && error.error?.ownerOnly)
          throw new OwnerOnlyError(error.error.access);
        throw new Error(
          typeof error.error?.error === 'string'
            ? error.error.error
            : 'Could not load messages. Try again.',
        );
      }
      throw error;
    }
  }
  directory(query: MessageHistoryQuery) {
    return this.request(
      firstValueFrom(
        this.http.get<MessageDirectory>('/api/device-data/message-conversations', {
          params: this.params(query),
        }),
      ),
    );
  }
  messages(query: MessageHistoryQuery) {
    return this.request(
      firstValueFrom(
        this.http.get<MessageHistoryPage>('/api/device-data/message-history', {
          params: this.params(query),
        }),
      ),
    );
  }
  preview(file: File) {
    const data = new FormData();
    data.append('file', file);
    return this.request(
      firstValueFrom(this.http.post<MessageArchiveProgress>('/api/message-archives/preview', data)),
    );
  }
  imports() {
    return this.request(
      firstValueFrom(this.http.get<{ imports: MessageArchiveProgress[] }>('/api/message-archives')),
    );
  }
  progress(id: string) {
    return this.request(
      firstValueFrom(
        this.http.get<MessageArchiveProgress>(`/api/message-archives/${encodeURIComponent(id)}`),
      ),
    );
  }
  start(id: string, input: { timeZone: string; dataset: string; platforms: string[] }) {
    return this.request(
      firstValueFrom(
        this.http.post<MessageArchiveProgress>(
          `/api/message-archives/${encodeURIComponent(id)}/start`,
          input,
        ),
      ),
    );
  }
  pause(id: string) {
    return this.request(
      firstValueFrom(
        this.http.post<MessageArchiveProgress>(
          `/api/message-archives/${encodeURIComponent(id)}/pause`,
          {},
        ),
      ),
    );
  }
}

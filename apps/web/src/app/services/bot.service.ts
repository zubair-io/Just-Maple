import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of, throwError } from 'rxjs';
import type {
  BotTemplate,
  UserBot,
  BotInvocation,
  CreateUserBotInput,
  UpdateUserBotInput,
  Thread,
  Message,
} from '@maple/shared';

export interface BotSuggestion {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string;
  description?: string;
  type: 'bot';
}

export interface EnrichedUserBot extends UserBot {
  templateName?: string;
  templateAvatar?: string;
  templateDescription?: string;
}

@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);

  // Bot templates (system-defined)
  private readonly _templates = signal<BotTemplate[]>([]);
  private readonly _templatesLoading = signal(false);

  // User bots (user-registered)
  private readonly _userBots = signal<EnrichedUserBot[]>([]);
  private readonly _userBotsLoading = signal(false);

  // Public signals
  readonly templates = this._templates.asReadonly();
  readonly templatesLoading = this._templatesLoading.asReadonly();
  readonly userBots = this._userBots.asReadonly();
  readonly userBotsLoading = this._userBotsLoading.asReadonly();

  // ============================================
  // Bot Templates
  // ============================================

  loadTemplates(): Observable<BotTemplate[]> {
    this._templatesLoading.set(true);

    return this.http.get<{ templates: BotTemplate[] }>('/api/bot-templates').pipe(
      tap((response) => {
        this._templates.set(response.templates);
        this._templatesLoading.set(false);
      }),
      map((response) => response.templates),
      catchError((err) => {
        this._templatesLoading.set(false);
        return of([]);
      }),
    );
  }

  getTemplate(id: string): Observable<BotTemplate | null> {
    return this.http.get<{ template: BotTemplate }>(`/api/bot-templates/${id}`).pipe(
      map((response) => response.template),
      catchError(() => of(null)),
    );
  }

  // ============================================
  // User Bots
  // ============================================

  loadUserBots(): Observable<EnrichedUserBot[]> {
    this._userBotsLoading.set(true);

    return this.http.get<{ userBots: EnrichedUserBot[] }>('/api/user-bots').pipe(
      tap((response) => {
        this._userBots.set(response.userBots);
        this._userBotsLoading.set(false);
      }),
      map((response) => response.userBots),
      catchError((err) => {
        this._userBotsLoading.set(false);
        return of([]);
      }),
    );
  }

  registerBot(data: CreateUserBotInput): Observable<EnrichedUserBot> {
    return this.http.post<{ userBot: EnrichedUserBot }>('/api/user-bots', data).pipe(
      tap((response) => {
        this._userBots.update((bots) => [...bots, response.userBot]);
      }),
      map((response) => response.userBot),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to register bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  updateBot(id: string, data: UpdateUserBotInput): Observable<UserBot> {
    return this.http.patch<{ userBot: UserBot }>(`/api/user-bots/${id}`, data).pipe(
      tap((response) => {
        this._userBots.update((bots) =>
          bots.map((b) => (b._id === id ? { ...b, ...response.userBot } : b)),
        );
      }),
      map((response) => response.userBot),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to update bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  deleteBot(id: string): Observable<void> {
    return this.http.delete(`/api/user-bots/${id}`).pipe(
      tap(() => {
        this._userBots.update((bots) => bots.filter((b) => b._id !== id));
      }),
      map(() => undefined),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to delete bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  // ============================================
  // Bot Search (for @mentions)
  // ============================================

  searchBots(tagId: string, query: string): Observable<BotSuggestion[]> {
    return this.http
      .get<{ bots: BotSuggestion[] }>(`/api/tags/${tagId}/bots/search`, {
        params: { q: query },
      })
      .pipe(
        map((response) => response.bots),
        catchError(() => of([])),
      );
  }

  // ============================================
  // Bot Invocation
  // ============================================

  invokeBot(
    tagId: string,
    botHandle: string,
    sourceType: 'message' | 'note',
    sourceId: string,
    context: {
      mentionText?: string;
      fullContent?: string;
      documentTitle?: string;
      selection?: string;
    },
  ): Observable<BotInvocation> {
    return this.http
      .post<{ invocation: BotInvocation }>(`/api/tags/${tagId}/bots/invoke`, {
        botHandle,
        sourceType,
        sourceId,
        context,
      })
      .pipe(
        map((response) => response.invocation),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to invoke bot';
          return throwError(() => new Error(message));
        }),
      );
  }

  getInvocationStatus(id: string): Observable<BotInvocation | null> {
    return this.http.get<{ invocation: BotInvocation }>(`/api/invocations/${id}`).pipe(
      map((response) => response.invocation),
      catchError(() => of(null)),
    );
  }

  // ============================================
  // Threads
  // ============================================

  getThreadForMessage(
    messageId: string,
  ): Observable<{ thread: Thread; messages: Message[] } | null> {
    return this.http
      .get<{ thread: Thread; messages: Message[] }>(`/api/messages/${messageId}/thread`)
      .pipe(
        map((response) => response),
        catchError(() => of(null)),
      );
  }

  getThreadMessages(
    threadId: string,
    options?: { limit?: number; before?: string },
  ): Observable<Message[]> {
    const params: Record<string, string> = {};
    if (options?.limit) params['limit'] = options.limit.toString();
    if (options?.before) params['before'] = options.before;

    return this.http
      .get<{ messages: Message[] }>(`/api/threads/${threadId}/messages`, { params })
      .pipe(
        map((response) => response.messages),
        catchError(() => of([])),
      );
  }
}

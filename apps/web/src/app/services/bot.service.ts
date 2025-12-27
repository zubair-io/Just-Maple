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
  Tag,
} from '@maple/shared';

export interface BotSuggestion {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string;
  description?: string;
  type: 'bot';
  // Owner info for disambiguation
  ownerId: string;
  ownerName: string;
  ownerAvatar?: string;
}

export interface EnrichedUserBot extends UserBot {
  templateName?: string;
  templateAvatar?: string;
  templateDescription?: string;
  ownerName?: string;
  ownerAvatar?: string;
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

  // Tag bots cache
  private readonly _tagBotsCache = new Map<string, BotSuggestion[]>();
  private readonly _tagBotsLoading = signal<Set<string>>(new Set());
  private readonly _tagBotsCacheVersion = signal(0);

  // Public signal for cache invalidation
  readonly tagBotsCacheVersion = this._tagBotsCacheVersion.asReadonly();

  // ============================================
  // Bot Templates
  // ============================================

  loadTemplates(forceRefresh = false): Observable<BotTemplate[]> {
    // Return cached if available and not forcing refresh
    if (!forceRefresh && this._templates().length > 0) {
      return of(this._templates());
    }

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

  getTagBots(tagId: string): Observable<BotSuggestion[]> {
    // Return cached if available
    const cached = this._tagBotsCache.get(tagId);
    if (cached) {
      return of(cached);
    }

    // Check if already loading
    if (this._tagBotsLoading().has(tagId)) {
      // Return empty for now, will be updated when load completes
      return of([]);
    }

    // Mark as loading
    this._tagBotsLoading.update((set) => new Set(set).add(tagId));

    return this.http.get<{ bots: BotSuggestion[] }>(`/api/tags/${tagId}/bots`).pipe(
      tap((response) => {
        this._tagBotsCache.set(tagId, response.bots);
        this._tagBotsLoading.update((set) => {
          const newSet = new Set(set);
          newSet.delete(tagId);
          return newSet;
        });
      }),
      map((response) => response.bots),
      catchError(() => {
        this._tagBotsLoading.update((set) => {
          const newSet = new Set(set);
          newSet.delete(tagId);
          return newSet;
        });
        return of([]);
      }),
    );
  }

  // Client-side filtering for bots
  static filterBots(bots: BotSuggestion[], query: string): BotSuggestion[] {
    if (!query.trim()) return bots;

    const lowerQuery = query.toLowerCase();
    return bots.filter(
      (bot) =>
        bot.handle.toLowerCase().includes(lowerQuery) ||
        bot.displayName.toLowerCase().includes(lowerQuery) ||
        bot.description?.toLowerCase().includes(lowerQuery),
    );
  }

  // Clear tag bots cache
  clearTagBotsCache(tagId?: string): void {
    if (tagId) {
      this._tagBotsCache.delete(tagId);
    } else {
      this._tagBotsCache.clear();
    }
    // Increment version to trigger reactive updates
    this._tagBotsCacheVersion.update((v) => v + 1);
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
  // Bot-Tag Sharing
  // ============================================

  // Get bots shared with a tag (with owner info)
  getTagSharedBots(tagId: string): Observable<EnrichedUserBot[]> {
    return this.http.get<{ bots: EnrichedUserBot[] }>(`/api/tags/${tagId}/shared-bots`).pipe(
      map((response) => response.bots),
      catchError(() => of([])),
    );
  }

  // Share bot with tag
  shareBotToTag(tagId: string, userBotId: string): Observable<Tag> {
    return this.http.post<{ tag: Tag }>(`/api/tags/${tagId}/bots`, { userBotId }).pipe(
      tap(() => {
        this.clearTagBotsCache(tagId);
      }),
      map((response) => response.tag),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to share bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  // Remove bot from tag
  unshareBotFromTag(tagId: string, userBotId: string): Observable<Tag> {
    return this.http.delete<{ tag: Tag }>(`/api/tags/${tagId}/bots/${userBotId}`).pipe(
      tap(() => {
        this.clearTagBotsCache(tagId);
      }),
      map((response) => response.tag),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to remove bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  // ============================================
  // Threads
  // ============================================

  getThreadById(threadId: string): Observable<Thread | null> {
    return this.http.get<{ thread: Thread }>(`/api/threads/${threadId}`).pipe(
      map((response) => response.thread),
      catchError(() => of(null)),
    );
  }

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

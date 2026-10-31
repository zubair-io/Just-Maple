import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of, throwError, from, switchMap } from 'rxjs';
import type {
  BotTemplate,
  BotModelOption,
  UserBot,
  BotInvocation,
  CreateUserBotInput,
  UpdateUserBotInput,
  CreateCustomBotInput,
  UpdateCustomBotInput,
  Thread,
  Message,
  Notebook,
} from '@maple/shared';
import { isLocalNotebook } from '../providers/data-provider.interface';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';

export interface BotSuggestion {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string;
  description?: string;
  type: 'bot';
  provider?: 'anthropic' | 'openai';
  defaultModel?: string;
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

export interface CustomBot extends UserBot {
  botType: 'custom';
  invokeUrl: string;
  webhookSecret?: string;
  permissions: {
    messages: { read: boolean; write: boolean };
    memos?: { read: boolean; write: boolean };
  };
  jwtExpirationHours: number;
  status: 'active' | 'disabled' | 'revoked';
}

export interface CustomBotWithToken extends CustomBot {
  botToken?: string; // Only present on creation
  webhookSecret?: string; // Only present on creation
}

interface LocalNotebookBotEntry {
  notebookId: string;
  bots: Array<{ userBotId: string; handle: string; addedAt: string }>;
}

@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);

  // Bot templates (system-defined)
  private readonly _templates = signal<BotTemplate[]>([]);
  private readonly _templatesLoading = signal(false);

  // User bots (user-registered template bots)
  private readonly _userBots = signal<EnrichedUserBot[]>([]);
  private readonly _userBotsLoading = signal(false);
  /** Whether the server has a web search key, so bots can be given web search. */
  private readonly _webSearchAvailable = signal(false);

  // Custom bots (user-created webhook bots)
  private readonly _customBots = signal<CustomBot[]>([]);
  private readonly _customBotsLoading = signal(false);

  // Public signals
  readonly templates = this._templates.asReadonly();
  readonly templatesLoading = this._templatesLoading.asReadonly();
  readonly userBots = this._userBots.asReadonly();
  readonly userBotsLoading = this._userBotsLoading.asReadonly();
  readonly webSearchAvailable = this._webSearchAvailable.asReadonly();
  readonly customBots = this._customBots.asReadonly();
  readonly customBotsLoading = this._customBotsLoading.asReadonly();

  // Notebook bots cache
  private readonly _notebookBotsCache = new Map<string, BotSuggestion[]>();
  private readonly _notebookBotsLoading = signal<Set<string>>(new Set());
  private readonly _notebookBotsCacheVersion = signal(0);

  // Public signal for cache invalidation
  readonly notebookBotsCacheVersion = this._notebookBotsCacheVersion.asReadonly();

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

    return this.http
      .get<{ userBots: EnrichedUserBot[]; webSearchAvailable?: boolean }>('/api/user-bots')
      .pipe(
        tap((response) => {
          this._userBots.set(response.userBots);
          this._webSearchAvailable.set(response.webSearchAvailable === true);
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
        this.clearNotebookBotsCache();
      }),
      map((response) => response.userBot),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to register bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  loadModels(input: {
    userBotId?: string;
    templateId?: string;
    apiKey?: string;
    baseUrl?: string;
  }): Observable<BotModelOption[]> {
    return this.http.post<{ models: BotModelOption[] }>('/api/bot-models', input).pipe(
      map((response) => response.models),
      catchError((err) =>
        throwError(() => new Error(err?.error?.error || 'Could not load provider models')),
      ),
    );
  }

  updateBot(id: string, data: UpdateUserBotInput): Observable<UserBot> {
    return this.http.patch<{ userBot: UserBot }>(`/api/user-bots/${id}`, data).pipe(
      tap((response) => {
        this._userBots.update((bots) =>
          bots.map((b) => (b._id === id ? { ...b, ...response.userBot } : b)),
        );
        this.clearNotebookBotsCache();
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
        this.clearNotebookBotsCache();
      }),
      map(() => undefined),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to delete bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  // ============================================
  // Custom Bots (webhook-based)
  // ============================================

  loadCustomBots(): Observable<CustomBot[]> {
    this._customBotsLoading.set(true);

    return this.http.get<{ bots: CustomBot[] }>('/api/custom-bots').pipe(
      tap((response) => {
        this._customBots.set(response.bots);
        this._customBotsLoading.set(false);
      }),
      map((response) => response.bots),
      catchError((err) => {
        this._customBotsLoading.set(false);
        return of([]);
      }),
    );
  }

  createCustomBot(data: CreateCustomBotInput): Observable<CustomBotWithToken> {
    return this.http
      .post<{
        bot: CustomBot;
        botToken: string;
        webhookSecret: string;
      }>('/api/custom-bots', data)
      .pipe(
        tap((response) => {
          this._customBots.update((bots) => [...bots, response.bot]);
          this.clearNotebookBotsCache();
        }),
        map((response) => ({
          ...response.bot,
          botToken: response.botToken,
          webhookSecret: response.webhookSecret,
        })),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to create custom bot';
          return throwError(() => new Error(message));
        }),
      );
  }

  getCustomBot(id: string): Observable<CustomBot | null> {
    return this.http.get<{ bot: CustomBot }>(`/api/custom-bots/${id}`).pipe(
      map((response) => response.bot),
      catchError(() => of(null)),
    );
  }

  updateCustomBot(id: string, data: UpdateCustomBotInput): Observable<CustomBot> {
    return this.http.patch<{ bot: CustomBot }>(`/api/custom-bots/${id}`, data).pipe(
      tap((response) => {
        this._customBots.update((bots) => bots.map((b) => (b._id === id ? response.bot : b)));
        this.clearNotebookBotsCache();
      }),
      map((response) => response.bot),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Failed to update custom bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  deleteCustomBot(id: string): Observable<void> {
    return this.http.delete(`/api/custom-bots/${id}`).pipe(
      tap(() => {
        this._customBots.update((bots) => bots.filter((b) => b._id !== id));
        this.clearNotebookBotsCache();
      }),
      map(() => undefined),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to delete custom bot';
        return throwError(() => new Error(message));
      }),
    );
  }

  regenerateBotToken(botId: string): Observable<string> {
    return this.http
      .post<{ botToken: string }>(`/api/custom-bots/${botId}/regenerate-token`, {})
      .pipe(
        map((response) => response.botToken),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to regenerate token';
          return throwError(() => new Error(message));
        }),
      );
  }

  regenerateWebhookSecret(botId: string): Observable<string> {
    return this.http
      .post<{ webhookSecret: string }>(`/api/custom-bots/${botId}/webhook-secret`, {})
      .pipe(
        tap((response) => {
          this._customBots.update((bots) =>
            bots.map((b) =>
              b._id === botId ? { ...b, webhookSecret: response.webhookSecret } : b,
            ),
          );
        }),
        map((response) => response.webhookSecret),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to regenerate webhook secret';
          return throwError(() => new Error(message));
        }),
      );
  }

  updateCustomBotStatus(botId: string, status: 'active' | 'disabled'): Observable<CustomBot> {
    return this.http.post<{ bot: CustomBot }>(`/api/custom-bots/${botId}/status`, { status }).pipe(
      tap((response) => {
        this._customBots.update((bots) => bots.map((b) => (b._id === botId ? response.bot : b)));
      }),
      map((response) => response.bot),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to update bot status';
        return throwError(() => new Error(message));
      }),
    );
  }

  // ============================================
  // Local Notebook Bot Management (IndexedDB)
  // ============================================

  private getLocalBotEntry(notebookId: string): Observable<LocalNotebookBotEntry> {
    return from(
      this.indexedDB.get<LocalNotebookBotEntry>(notebookId, DB_STORES.LOCAL_NOTEBOOK_BOTS),
    ).pipe(map((entry) => entry ?? { notebookId, bots: [] }));
  }

  getLocalNotebookBots(notebookId: string): Observable<BotSuggestion[]> {
    return this.getLocalBotEntry(notebookId).pipe(
      map((entry) => {
        const userBots = this._userBots();
        const results: BotSuggestion[] = [];
        for (const localBot of entry.bots) {
          const userBot = userBots.find((ub) => ub._id === localBot.userBotId);
          if (!userBot) continue;
          results.push({
            id: userBot._id,
            handle: userBot.handle,
            displayName: userBot.displayName || userBot.templateName || userBot.handle,
            avatar: userBot.templateAvatar,
            description: userBot.templateDescription,
            type: 'bot',
            ownerId: userBot.userId,
            ownerName: userBot.ownerName || '',
            ownerAvatar: userBot.ownerAvatar,
          });
        }
        return results;
      }),
    );
  }

  addBotToLocalNotebook(notebookId: string, userBotId: string): Observable<void> {
    const userBot = this._userBots().find((ub) => ub._id === userBotId);
    if (!userBot) {
      return throwError(() => new Error('Bot not found'));
    }

    return this.getLocalBotEntry(notebookId).pipe(
      switchMap((entry) => {
        if (entry.bots.some((b) => b.userBotId === userBotId)) {
          return of(undefined as void);
        }
        entry.bots.push({
          userBotId,
          handle: userBot.handle,
          addedAt: new Date().toISOString(),
        });
        return from(this.indexedDB.put(entry, DB_STORES.LOCAL_NOTEBOOK_BOTS)).pipe(
          map(() => undefined as void),
        );
      }),
      tap(() => this.clearNotebookBotsCache(notebookId)),
    );
  }

  removeBotFromLocalNotebook(notebookId: string, userBotId: string): Observable<void> {
    return this.getLocalBotEntry(notebookId).pipe(
      switchMap((entry) => {
        entry.bots = entry.bots.filter((b) => b.userBotId !== userBotId);
        return from(this.indexedDB.put(entry, DB_STORES.LOCAL_NOTEBOOK_BOTS)).pipe(
          map(() => undefined as void),
        );
      }),
      tap(() => this.clearNotebookBotsCache(notebookId)),
    );
  }

  getLocalNotebookSharedBots(notebookId: string): Observable<EnrichedUserBot[]> {
    return this.getLocalBotEntry(notebookId).pipe(
      map((entry) => {
        const userBots = this._userBots();
        return entry.bots
          .map((localBot) => userBots.find((ub) => ub._id === localBot.userBotId))
          .filter((b): b is EnrichedUserBot => b !== undefined);
      }),
    );
  }

  // ============================================
  // Bot Search (for @mentions)
  // ============================================

  getNotebookBots(notebookId: string): Observable<BotSuggestion[]> {
    // Route local notebooks to IndexedDB
    if (isLocalNotebook(notebookId)) {
      // Return cached if available
      const cached = this._notebookBotsCache.get(notebookId);
      if (cached) return of(cached);

      return this.getLocalNotebookBots(notebookId).pipe(
        tap((bots) => this._notebookBotsCache.set(notebookId, bots)),
      );
    }

    // Return cached if available
    const cached = this._notebookBotsCache.get(notebookId);
    if (cached) {
      return of(cached);
    }

    // Check if already loading
    if (this._notebookBotsLoading().has(notebookId)) {
      // Return empty for now, will be updated when load completes
      return of([]);
    }

    // Mark as loading
    this._notebookBotsLoading.update((set) => new Set(set).add(notebookId));

    return this.http.get<{ bots: BotSuggestion[] }>(`/api/notebooks/${notebookId}/bots`).pipe(
      tap((response) => {
        this._notebookBotsCache.set(notebookId, response.bots);
        this._notebookBotsLoading.update((set) => {
          const newSet = new Set(set);
          newSet.delete(notebookId);
          return newSet;
        });
      }),
      map((response) => response.bots),
      catchError(() => {
        this._notebookBotsLoading.update((set) => {
          const newSet = new Set(set);
          newSet.delete(notebookId);
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

  // Clear notebook bots cache
  clearNotebookBotsCache(notebookId?: string): void {
    if (notebookId) {
      this._notebookBotsCache.delete(notebookId);
    } else {
      this._notebookBotsCache.clear();
    }
    // Increment version to trigger reactive updates
    this._notebookBotsCacheVersion.update((v) => v + 1);
  }

  // ============================================
  // Bot Invocation
  // ============================================

  invokeBot(
    notebookId: string,
    botHandle: string,
    sourceType: 'message' | 'page',
    sourceId: string,
    context: {
      model?: string;
      mentionText?: string;
      fullContent?: string;
      documentTitle?: string;
      selection?: string;
    },
  ): Observable<BotInvocation> {
    return this.http
      .post<{ invocation: BotInvocation }>(`/api/notebooks/${notebookId}/bots/invoke`, {
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
  // Bot-Notebook Sharing
  // ============================================

  // Get bots shared with a notebook (with owner info)
  getNotebookSharedBots(notebookId: string): Observable<EnrichedUserBot[]> {
    if (isLocalNotebook(notebookId)) {
      return this.getLocalNotebookSharedBots(notebookId);
    }

    return this.http
      .get<{ bots: EnrichedUserBot[] }>(`/api/notebooks/${notebookId}/shared-bots`)
      .pipe(
        map((response) => response.bots),
        catchError(() => of([])),
      );
  }

  // Share bot with notebook
  shareBotToNotebook(notebookId: string, userBotId: string): Observable<Notebook> {
    if (isLocalNotebook(notebookId)) {
      return this.addBotToLocalNotebook(notebookId, userBotId).pipe(
        map(() => ({ _id: notebookId }) as Notebook),
      );
    }

    return this.http
      .post<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/bots`, { userBotId })
      .pipe(
        tap(() => {
          this.clearNotebookBotsCache(notebookId);
        }),
        map((response) => response.notebook),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to share bot';
          return throwError(() => new Error(message));
        }),
      );
  }

  // Remove bot from notebook
  unshareBotFromNotebook(notebookId: string, userBotId: string): Observable<Notebook> {
    if (isLocalNotebook(notebookId)) {
      return this.removeBotFromLocalNotebook(notebookId, userBotId).pipe(
        map(() => ({ _id: notebookId }) as Notebook),
      );
    }

    return this.http
      .delete<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/bots/${userBotId}`)
      .pipe(
        tap(() => {
          this.clearNotebookBotsCache(notebookId);
        }),
        map((response) => response.notebook),
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
        catchError((error) => (error.status === 404 ? of(null) : throwError(() => error))),
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

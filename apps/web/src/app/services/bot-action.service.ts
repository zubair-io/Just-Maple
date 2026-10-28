import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import type {
  BotAction,
  BotActionKind,
  BotActionStatus,
  BotActionUpdate,
  BotAutonomy,
} from '@maple/shared';
import { RealtimeService } from './realtime.service';
import { AuthService } from './auth.service';

export interface ActionLogScope {
  botId?: string;
  notebookId?: string;
}

export interface ActionLogFilters {
  kind?: BotActionKind | '';
  status?: BotActionStatus | '';
}

/**
 * The bot action log: "Done · Undo" cards, the Activity lists, and each bot's autonomy
 * settings. Rows are kept by id so a card and a list show the same state. The server's
 * `bot_action_updated` events carry only the summary; for the owner's own rows the full
 * row is fetched again (it holds the details and whether Undo is offered).
 */
@Injectable({ providedIn: 'root' })
export class BotActionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly _actions = signal<Record<string, BotAction>>({});
  readonly actions = this._actions.asReadonly();
  private readonly loading = new Set<string>();
  /** Rows a card or list is showing: only those are fetched again on events. */
  private readonly wanted = new Set<string>();

  constructor() {
    inject(RealtimeService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.action !== 'bot_action_updated') return;
        const update = event.data as BotActionUpdate | null;
        if (!update?.id) return;
        this.mergeUpdate(update);
        if (this.wanted.has(update.id) && update.ownerId === this.auth.user()?._id)
          void this.load(update.id, true);
      });
  }

  /** One row (a card). Later changes arrive as events. */
  async load(id: string, force = false): Promise<void> {
    this.wanted.add(id);
    if (this.loading.has(id) || (!force && this._actions()[id])) return;
    this.loading.add(id);
    try {
      const { action } = await firstValueFrom(
        this.http.get<{ action: BotAction }>(`/api/bot-actions/${encodeURIComponent(id)}`),
      );
      this.merge([action]);
    } catch {
      // The card keeps showing what the message saved.
    } finally {
      this.loading.delete(id);
    }
  }

  /** A bot's or a notebook's Activity, newest first. */
  async list(scope: ActionLogScope, filters: ActionLogFilters = {}): Promise<BotAction[]> {
    let params = new HttpParams();
    if (scope.botId) params = params.set('botId', scope.botId);
    if (scope.notebookId) params = params.set('notebookId', scope.notebookId);
    if (filters.kind) params = params.set('kind', filters.kind);
    if (filters.status) params = params.set('status', filters.status);
    const { actions } = await firstValueFrom(
      this.http.get<{ actions: BotAction[] }>('/api/bot-actions', { params }),
    );
    for (const action of actions) this.wanted.add(action.id);
    this.merge(actions);
    return actions.map((action) => action.id).map((id) => this._actions()[id]!);
  }

  /** The owner's Undo. Throws with the server's reason when it can't be undone. */
  async undo(id: string): Promise<BotAction> {
    try {
      const { action } = await firstValueFrom(
        this.http.post<{ action: BotAction }>(
          `/api/bot-actions/${encodeURIComponent(id)}/undo`,
          {},
        ),
      );
      this.merge([action]);
      return action;
    } catch (error) {
      const message = (error as { error?: { error?: string } })?.error?.error;
      void this.load(id, true);
      throw new Error(message || 'Could not undo it. Try again.');
    }
  }

  /** The owner's Cancel of a queued action. Throws with the server's reason. */
  async cancel(id: string): Promise<BotAction> {
    try {
      const { action } = await firstValueFrom(
        this.http.post<{ action: BotAction }>(
          `/api/bot-actions/${encodeURIComponent(id)}/cancel`,
          {},
        ),
      );
      this.merge([action]);
      return action;
    } catch (error) {
      void this.load(id, true);
      throw new Error(serverMessage(error) || 'Could not cancel it. Try again.');
    }
  }

  /** The owner's edits to a drafted reply. */
  async saveDraft(id: string, body: string): Promise<BotAction> {
    return this.draftCall(id, '', body);
  }

  /**
   * The owner opened a drafted reply in Messages or Mail (the link does the opening):
   * saves their text and records it. Returns the compose link the server built.
   */
  async openDraft(id: string, body: string): Promise<{ action: BotAction; url: string }> {
    try {
      const result = await firstValueFrom(
        this.http.post<{ action: BotAction; url: string }>(
          `/api/reply-drafts/${encodeURIComponent(id)}/open`,
          { body },
        ),
      );
      this.merge([result.action]);
      return result;
    } catch (error) {
      void this.load(id, true);
      throw new Error(serverMessage(error) || 'Could not save the draft. Try again.');
    }
  }

  async discardDraft(id: string): Promise<BotAction> {
    return this.draftCall(id, '/discard');
  }

  private async draftCall(id: string, path: '' | '/discard', body?: string): Promise<BotAction> {
    const url = `/api/reply-drafts/${encodeURIComponent(id)}${path}`;
    try {
      const { action } = await firstValueFrom(
        path
          ? this.http.post<{ action: BotAction }>(url, {})
          : this.http.patch<{ action: BotAction }>(url, { body }),
      );
      this.merge([action]);
      return action;
    } catch (error) {
      void this.load(id, true);
      throw new Error(serverMessage(error) || 'Could not update the draft. Try again.');
    }
  }

  async autonomy(botId: string): Promise<Record<BotActionKind, BotAutonomy>> {
    const { settings } = await firstValueFrom(
      this.http.get<{ settings: Record<BotActionKind, BotAutonomy> }>(
        `/api/bot-autonomy/${encodeURIComponent(botId)}`,
      ),
    );
    return settings;
  }

  async setAutonomy(
    botId: string,
    kind: BotActionKind,
    autonomy: BotAutonomy,
  ): Promise<Record<BotActionKind, BotAutonomy>> {
    const { settings } = await firstValueFrom(
      this.http.put<{ settings: Record<BotActionKind, BotAutonomy> }>(
        `/api/bot-autonomy/${encodeURIComponent(botId)}`,
        { kind, autonomy },
      ),
    );
    return settings;
  }

  /** Full rows from the server win over what's held, unless what's held is newer. */
  private merge(rows: BotAction[]): void {
    this._actions.update((all) => {
      const next = { ...all };
      for (const row of rows) {
        const current = all[row.id];
        if (!current || current.updatedAt <= row.updatedAt) next[row.id] = row;
      }
      return next;
    });
  }

  /** A broadcast: newer summary fields over the row held (its details stay until reloaded). */
  private mergeUpdate(update: BotActionUpdate): void {
    this._actions.update((all) => {
      const current = all[update.id];
      if (current && current.updatedAt > update.updatedAt) return all;
      const isOwner = update.ownerId === this.auth.user()?._id;
      return {
        ...all,
        [update.id]: {
          ...(current ?? {}),
          ...update,
          isOwner,
          // Whether Undo is offered comes from the full row.
          canUndo: isOwner && update.status === 'done' && !!current?.canUndo,
          canCancel:
            isOwner &&
            (update.status === 'queued' || update.status === 'auto') &&
            !update.cancelRequestedAt &&
            !!current?.canCancel,
        } as BotAction,
      };
    });
  }
}

function serverMessage(error: unknown): string | undefined {
  return (error as { error?: { error?: string } })?.error?.error;
}

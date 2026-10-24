import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ChatEvent } from '@maple/shared';
import { RealtimeService } from './realtime.service';

/** A bot that is working on a reply right now. */
export interface ActiveBotReply {
  invocationId: string;
  botName: string;
  /** The message being answered: the thread's parent, or the message itself. */
  sourceId: string;
  /** Proactive chats answer in the conversation itself instead of in a thread. */
  replyTopLevel: boolean;
  notebookId: string;
}

/** A reply that never reports back (lost connection, server restart) stops showing after this. */
const STALE_AFTER_MS = 3 * 60 * 1000;

/**
 * Tracks bots that are writing a reply, from the server's bot_invocation_* events, so
 * the chat and thread panel can show "Claude is typing…" where the reply will appear.
 */
@Injectable({ providedIn: 'root' })
export class BotActivityService {
  private readonly _active = signal<ActiveBotReply[]>([]);
  readonly active = this._active.asReadonly();

  /** Bots answering top-level in a notebook's chat (proactive chats). */
  readonly topLevelByNotebook = computed(() => {
    const map = new Map<string, string[]>();
    for (const reply of this._active()) {
      if (!reply.replyTopLevel) continue;
      map.set(reply.notebookId, [...(map.get(reply.notebookId) ?? []), reply.botName]);
    }
    return map;
  });

  /** Bots answering in the thread under each message. */
  readonly inThreadBySource = computed(() => {
    const map = new Map<string, string[]>();
    for (const reply of this._active()) {
      if (reply.replyTopLevel) continue;
      map.set(reply.sourceId, [...(map.get(reply.sourceId) ?? []), reply.botName]);
    }
    return map;
  });

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    inject(RealtimeService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => this.handle(event));
  }

  private handle(event: ChatEvent): void {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const invocationId = typeof data['invocationId'] === 'string' ? data['invocationId'] : null;
    if (!invocationId) return;

    if (event.action === 'bot_invocation_started') {
      const reply: ActiveBotReply = {
        invocationId,
        botName: typeof data['botName'] === 'string' ? data['botName'] : 'Bot',
        sourceId: String(data['sourceId'] ?? ''),
        replyTopLevel: data['replyTopLevel'] === true,
        notebookId: event.notebookId ?? '',
      };
      this._active.update((list) => [
        ...list.filter((r) => r.invocationId !== invocationId),
        reply,
      ]);
      clearTimeout(this.timers.get(invocationId));
      this.timers.set(
        invocationId,
        setTimeout(() => this.finish(invocationId), STALE_AFTER_MS),
      );
    } else if (
      event.action === 'bot_invocation_completed' ||
      event.action === 'bot_invocation_failed'
    ) {
      this.finish(invocationId);
    }
  }

  private finish(invocationId: string): void {
    clearTimeout(this.timers.get(invocationId));
    this.timers.delete(invocationId);
    this._active.update((list) => list.filter((r) => r.invocationId !== invocationId));
  }
}

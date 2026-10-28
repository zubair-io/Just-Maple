import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { FollowUp, FollowUpAction, FollowUpList } from '@maple/shared';

/**
 * Your follow-ups in one notebook (its Follow-ups page): promises and replies owed, found
 * in your messages and mail. The server only returns ones whose evidence the notebook's
 * data pages share.
 */
@Injectable({ providedIn: 'root' })
export class FollowUpsService {
  private readonly http = inject(HttpClient);

  private readonly _list = signal<FollowUpList | null>(null);
  readonly list = this._list.asReadonly();
  readonly notebookId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async load(notebookId: string): Promise<void> {
    if (this.notebookId() !== notebookId) {
      this._list.set(null);
      this.notebookId.set(notebookId);
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const reply = await firstValueFrom(
        this.http.get<FollowUpList>(`/api/follow-ups/${encodeURIComponent(notebookId)}`),
      );
      // A reply for a notebook that's no longer open is dropped.
      if (this.notebookId() !== notebookId) return;
      this._list.set(reply);
    } catch (err) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(message || 'Could not load follow-ups.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Done, snooze (until an ISO time), dismiss or reopen. Done and dismissed ones move to
   * Recently closed; reopen puts one back.
   */
  async act(followUp: FollowUp, action: FollowUpAction, until?: string): Promise<FollowUp> {
    const notebookId = this.notebookId();
    if (!notebookId) throw new Error('No notebook');
    const reply = await firstValueFrom(
      this.http.patch<{ followUp: FollowUp }>(
        `/api/follow-ups/${encodeURIComponent(notebookId)}/${encodeURIComponent(followUp.id)}`,
        { action, ...(until ? { until } : {}) },
      ),
    );
    const updated = reply.followUp;
    this._list.update((list) => (list ? placeFollowUp(list, updated) : list));
    return updated;
  }
}

/** Puts a changed follow-up in the open list or in Recently closed (newest first). */
export function placeFollowUp(list: FollowUpList, updated: FollowUp): FollowUpList {
  const followUps = list.followUps.filter((entry) => entry.id !== updated.id);
  const recent = (list.recent ?? []).filter((entry) => entry.id !== updated.id);
  if (updated.status === 'open' || updated.status === 'snoozed')
    return { ...list, followUps: [...followUps, updated], recent };
  return { ...list, followUps, recent: [updated, ...recent] };
}

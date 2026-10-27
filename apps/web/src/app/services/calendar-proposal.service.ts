import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import type { CalendarProposal } from '@maple/shared';
import { RealtimeService } from './realtime.service';

/**
 * Live state of "Add to calendar" cards. A card loads its proposal's full state once
 * (including `canConfirm`, which depends on who is looking); the server's
 * `calendar_proposal_updated` events keep it current (adding → added on every device).
 * An event for a card that hasn't finished loading is merged in, and the card's load
 * still runs, so the owner never loses the button.
 */
@Injectable({ providedIn: 'root' })
export class CalendarProposalService {
  private readonly http = inject(HttpClient);
  private readonly _proposals = signal<Record<string, CalendarProposal>>({});
  readonly proposals = this._proposals.asReadonly();
  /** Proposals whose full state came from the server, not just from events. */
  private readonly complete = new Set<string>();
  /** Proposals a card asked for: only those are fetched. */
  private readonly wanted = new Set<string>();
  private readonly loading = new Set<string>();

  constructor() {
    inject(RealtimeService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.action !== 'calendar_proposal_updated') return;
        const update = event.data as Omit<CalendarProposal, 'canConfirm'> | null;
        if (!update?.id) return;
        this.merge(update);
        // Shown on a card but never fully loaded: get who-can-confirm from the server.
        if (this.wanted.has(update.id) && !this.complete.has(update.id)) void this.load(update.id);
      });
  }

  /** Loads a card's full state once; later changes arrive as events. */
  async load(id: string): Promise<void> {
    this.wanted.add(id);
    if (this.complete.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const { proposal } = await firstValueFrom(
        this.http.get<{ proposal: CalendarProposal }>(`/api/calendar-proposals/${id}`),
      );
      this.complete.add(id);
      this.merge(proposal);
    } catch {
      // The card keeps showing the event without a button.
    } finally {
      this.loading.delete(id);
    }
  }

  /** The owner's tap. Throws with the server's reason when it can't be added. */
  async confirm(id: string): Promise<CalendarProposal> {
    try {
      const { proposal } = await firstValueFrom(
        this.http.post<{ proposal: CalendarProposal }>(`/api/calendar-proposals/${id}/confirm`, {}),
      );
      this.complete.add(id);
      this.merge(proposal);
      return proposal;
    } catch (error) {
      const message = (error as { error?: { error?: string } })?.error?.error;
      // Expired meanwhile, for example: show what the server has now.
      this.complete.delete(id);
      this._proposals.update(({ [id]: _, ...rest }) => rest);
      void this.load(id);
      throw new Error(message || 'Could not add the event. Try again.');
    }
  }

  /**
   * Takes the newer state, by `updatedAt`. `canConfirm` comes only from a full load
   * (events leave it out); until then it is false.
   */
  private merge(next: Omit<CalendarProposal, 'canConfirm'> & { canConfirm?: boolean }): void {
    this._proposals.update((all) => {
      const current = all[next.id];
      const canConfirm = next.canConfirm ?? current?.canConfirm ?? false;
      const state = current && current.updatedAt > next.updatedAt ? current : next;
      if (current && state === current && current.canConfirm === canConfirm) return all;
      return { ...all, [next.id]: { ...state, canConfirm } as CalendarProposal };
    });
  }
}

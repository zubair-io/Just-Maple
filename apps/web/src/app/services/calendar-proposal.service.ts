import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import type { CalendarProposal } from '@maple/shared';
import { RealtimeService } from './realtime.service';

/**
 * Live state of "Add to calendar" cards. Cards load their proposal once; the server's
 * `calendar_proposal_updated` events keep it current (adding → added on every device).
 */
@Injectable({ providedIn: 'root' })
export class CalendarProposalService {
  private readonly http = inject(HttpClient);
  private readonly _proposals = signal<Record<string, CalendarProposal>>({});
  readonly proposals = this._proposals.asReadonly();
  private readonly loading = new Set<string>();

  constructor() {
    inject(RealtimeService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.action !== 'calendar_proposal_updated') return;
        const update = event.data as Omit<CalendarProposal, 'canConfirm'> | null;
        if (!update?.id) return;
        // Events leave out canConfirm: it depends on who is looking, so keep ours.
        this._proposals.update((all) => {
          const current = all[update.id];
          if (current && current.updatedAt > update.updatedAt) return all;
          return {
            ...all,
            [update.id]: { ...update, canConfirm: current?.canConfirm ?? false },
          };
        });
      });
  }

  /** Loads a card's state once; later changes arrive as events. */
  async load(id: string): Promise<void> {
    if (this._proposals()[id] || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const { proposal } = await firstValueFrom(
        this.http.get<{ proposal: CalendarProposal }>(`/api/calendar-proposals/${id}`),
      );
      this.set(proposal);
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
      this.set(proposal);
      return proposal;
    } catch (error) {
      const message = (error as { error?: { error?: string } })?.error?.error;
      // Expired meanwhile, for example: show what the server has now.
      this._proposals.update(({ [id]: _, ...rest }) => rest);
      void this.load(id);
      throw new Error(message || 'Could not add the event. Try again.');
    }
  }

  private set(proposal: CalendarProposal): void {
    this._proposals.update((all) => ({ ...all, [proposal.id]: proposal }));
  }
}

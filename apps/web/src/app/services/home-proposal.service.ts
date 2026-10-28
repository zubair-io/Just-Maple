import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import type { HomeProposal } from '@maple/shared';
import { RealtimeService } from './realtime.service';

/** The server wants the second tap a lock or garage door needs (HTTP 428). */
export class HomeAcknowledgeNeeded extends Error {}

/**
 * Live state of Home Assistant cards, the same way CalendarProposalService does it: a card
 * loads its proposal once (with `canConfirm`, which depends on who is looking), and
 * `home_proposal_updated` events keep it current (running → done on every device).
 */
@Injectable({ providedIn: 'root' })
export class HomeProposalService {
  private readonly http = inject(HttpClient);
  private readonly _proposals = signal<Record<string, HomeProposal>>({});
  readonly proposals = this._proposals.asReadonly();
  private readonly complete = new Set<string>();
  private readonly wanted = new Set<string>();
  private readonly loading = new Set<string>();

  constructor() {
    inject(RealtimeService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.action !== 'home_proposal_updated') return;
        const update = event.data as Omit<HomeProposal, 'canConfirm'> | null;
        if (!update?.id) return;
        this.merge(update);
        if (this.wanted.has(update.id) && !this.complete.has(update.id)) void this.load(update.id);
      });
  }

  async load(id: string): Promise<void> {
    this.wanted.add(id);
    if (this.complete.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const { proposal } = await firstValueFrom(
        this.http.get<{ proposal: HomeProposal }>(`/api/home-proposals/${id}`),
      );
      this.complete.add(id);
      this.merge(proposal);
    } catch {
      // The card keeps showing the action without a button.
    } finally {
      this.loading.delete(id);
    }
  }

  /**
   * The owner's tap. `acknowledged` is the second tap for locks and garage doors.
   * Throws HomeAcknowledgeNeeded when the server asks for it, or the server's reason.
   */
  async confirm(id: string, acknowledged = false): Promise<HomeProposal> {
    try {
      const { proposal } = await firstValueFrom(
        this.http.post<{ proposal: HomeProposal }>(
          `/api/home-proposals/${id}/confirm`,
          acknowledged ? { acknowledged: true } : {},
        ),
      );
      this.complete.add(id);
      this.merge(proposal);
      return proposal;
    } catch (error) {
      const response = error as { status?: number; error?: { error?: string; message?: string } };
      if (response?.status === 428) throw new HomeAcknowledgeNeeded();
      this.complete.delete(id);
      this._proposals.update(({ [id]: _, ...rest }) => rest);
      void this.load(id);
      throw new Error(
        response?.error?.message || response?.error?.error || "Couldn't do that. Try again.",
      );
    }
  }

  private merge(next: Omit<HomeProposal, 'canConfirm'> & { canConfirm?: boolean }): void {
    this._proposals.update((all) => {
      const current = all[next.id];
      const canConfirm = next.canConfirm ?? current?.canConfirm ?? false;
      const state = current && current.updatedAt > next.updatedAt ? current : next;
      if (current && state === current && current.canConfirm === canConfirm) return all;
      return { ...all, [next.id]: { ...state, canConfirm } as HomeProposal };
    });
  }
}

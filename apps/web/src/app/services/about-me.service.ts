import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AboutMe,
  ProfileEntity,
  ProfileFact,
  ProfileRelation,
  UpdateProfileFactInput,
} from '@maple/shared';

/**
 * Your About me in one notebook (on its About me page): what bots learned about you and
 * your people. Bots build it; this service lets you see, edit, approve and undo. Each
 * member of a notebook only ever sees their own. Named places belong to the account.
 */
@Injectable({ providedIn: 'root' })
export class AboutMeService {
  private readonly http = inject(HttpClient);

  private readonly _profile = signal<AboutMe | null>(null);
  readonly profile = this._profile.asReadonly();
  /** Someone besides the owner can read the notebook. */
  readonly shared = signal(false);
  readonly notebookId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Entity id → entity, for showing names next to facts and relations. */
  readonly entitiesById = computed(() => {
    const map = new Map<string, ProfileEntity>();
    for (const entity of this._profile()?.entities ?? []) map.set(entity.id, entity);
    return map;
  });

  async load(notebookId: string): Promise<void> {
    if (this.notebookId() !== notebookId) {
      this._profile.set(null);
      this.notebookId.set(notebookId);
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const reply = await firstValueFrom(
        this.http.get<{ aboutMe: AboutMe; shared: boolean }>('/api/about-me', {
          params: { notebookId },
        }),
      );
      // A reply for a notebook that's no longer open is dropped.
      if (this.notebookId() !== notebookId) return;
      this._profile.set(reply.aboutMe);
      this.shared.set(reply.shared);
    } catch (err) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(message || 'Could not load About me.');
    } finally {
      this.loading.set(false);
    }
  }

  async updateFact(id: string, changes: UpdateProfileFactInput): Promise<void> {
    await this.change((notebookId) =>
      this.http.patch(`/api/about-me/facts/${id}`, changes, { params: { notebookId } }),
    );
  }

  approve(fact: ProfileFact): Promise<void> {
    return this.updateFact(fact.id, { status: 'active' });
  }

  /**
   * Removes a fact, or dismisses a suggestion. Kept in history and hidden everywhere; a
   * fact that replaced an older one brings that one back (undo).
   */
  remove(fact: ProfileFact): Promise<void> {
    return this.updateFact(fact.id, { status: 'removed' });
  }

  /** Puts back a fact that was just removed. */
  restore(fact: ProfileFact): Promise<void> {
    return this.updateFact(fact.id, { status: 'active' });
  }

  async updateRelation(relation: ProfileRelation, type: string): Promise<void> {
    await this.change((notebookId) =>
      this.http.patch(
        `/api/about-me/relations/${relation.id}`,
        { type },
        { params: { notebookId } },
      ),
    );
  }

  async removeRelation(relation: ProfileRelation): Promise<void> {
    await this.change((notebookId) =>
      this.http.delete(`/api/about-me/relations/${relation.id}`, { params: { notebookId } }),
    );
  }

  /** Names a place (account-wide), e.g. "Home" at a visit's coordinates. */
  async namePlace(input: {
    name: string;
    lat: number;
    lon: number;
    address?: string;
  }): Promise<void> {
    await firstValueFrom(this.http.post('/api/about-me/places', input));
  }

  private async change(request: (notebookId: string) => ReturnType<HttpClient['get']>) {
    const notebookId = this.notebookId();
    if (!notebookId) return;
    await firstValueFrom(request(notebookId));
    await this.load(notebookId);
  }
}

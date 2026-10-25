import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AboutMe,
  ProfileEntity,
  ProfileEntityKind,
  ProfileFact,
  SaveProfileFactInput,
  UpdateProfileFactInput,
} from '@maple/shared';

/**
 * The user's About me profile: their people, lasting facts and what's true right now.
 * Bots keep it up to date; this service lets the user see, edit, approve and undo.
 */
@Injectable({ providedIn: 'root' })
export class AboutMeService {
  private readonly http = inject(HttpClient);

  private readonly _profile = signal<AboutMe | null>(null);
  readonly profile = this._profile.asReadonly();
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Entity id → entity, for showing names next to facts and relations. */
  readonly entitiesById = computed(() => {
    const map = new Map<string, ProfileEntity>();
    for (const entity of this._profile()?.entities ?? []) map.set(entity.id, entity);
    return map;
  });

  async load(): Promise<void> {
    await this.run(() => this.http.get<{ aboutMe: AboutMe }>('/api/about-me'));
  }

  /** Creates the profile from contacts and calendar (normally done by the first proactive bot). */
  async start(): Promise<void> {
    await this.run(() => this.http.post<{ aboutMe: AboutMe }>('/api/about-me', {}));
  }

  async addPerson(input: {
    kind: ProfileEntityKind;
    name: string;
    relationToMe?: string;
  }): Promise<void> {
    await firstValueFrom(this.http.post('/api/about-me/entities', input));
    await this.load();
  }

  async removePerson(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/about-me/entities/${id}`));
    await this.load();
  }

  async addFact(input: SaveProfileFactInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/about-me/facts', input));
    await this.load();
  }

  async updateFact(id: string, changes: UpdateProfileFactInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/about-me/facts/${id}`, changes));
    await this.load();
  }

  approve(fact: ProfileFact): Promise<void> {
    return this.updateFact(fact.id, { status: 'active' });
  }

  /** Undo a learned fact, or dismiss a suggestion. Kept in history, hidden everywhere. */
  remove(fact: ProfileFact): Promise<void> {
    return this.updateFact(fact.id, { status: 'removed' });
  }

  async deleteAll(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/about-me'));
    this._profile.set(null);
    await this.load();
  }

  private async run(request: () => ReturnType<HttpClient['get']>): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { aboutMe } = (await firstValueFrom(request())) as { aboutMe: AboutMe };
      this._profile.set(aboutMe);
    } catch (err) {
      const message = (err as { error?: { error?: string } })?.error?.error;
      this.error.set(message || 'Could not load About me');
    } finally {
      this.loading.set(false);
    }
  }
}

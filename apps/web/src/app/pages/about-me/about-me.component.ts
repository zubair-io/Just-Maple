import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { ProfileEntity, ProfileFact } from '@maple/shared';
import { AboutMeService } from '../../services/about-me.service';
import { SettingsHeaderComponent, DialogService } from '../../components';

interface PersonView {
  entity: ProfileEntity;
  relation: string;
  facts: ProfileFact[];
}

@Component({
  selector: 'app-about-me',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe, SettingsHeaderComponent],
  templateUrl: './about-me.component.html',
  styleUrl: './about-me.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AboutMeComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  readonly aboutMe = inject(AboutMeService);

  readonly profile = this.aboutMe.profile;
  readonly me = computed(() => this.profile()?.me ?? null);

  /** People and pets connected to you, each with what's known about them. */
  readonly people = computed<PersonView[]>(() => {
    const profile = this.profile();
    const me = profile?.me;
    if (!profile || !me) return [];
    return profile.entities
      .filter((entity) => !entity.isMe && entity.kind !== 'place')
      .map((entity) => ({
        entity,
        relation: profile.relations
          .filter((r) => r.from === me.id && r.to === entity.id)
          .map((r) => this.label(r.type))
          .join(', '),
        facts: profile.facts.filter((fact) => fact.about === entity.id),
      }))
      .sort((a, b) => (a.relation ? 0 : 1) - (b.relation ? 0 : 1));
  });

  readonly rightNow = computed(() =>
    (this.profile()?.facts ?? []).filter((f) => f.kind === 'current' && f.about === this.me()?.id),
  );
  readonly lasting = computed(() =>
    (this.profile()?.facts ?? []).filter((f) => f.kind === 'lasting' && f.about === this.me()?.id),
  );

  // Forms
  readonly newPersonName = signal('');
  readonly newPersonRelation = signal('');
  readonly newNow = signal('');
  readonly newNowUntil = signal('');
  readonly newFactKey = signal('');
  readonly newFactValue = signal('');
  readonly editingId = signal<string | null>(null);
  readonly editingValue = signal('');

  ngOnInit(): void {
    void this.aboutMe.load();
  }

  goBack(): void {
    void this.router.navigate(['/settings']);
  }

  start(): void {
    void this.aboutMe.start();
  }

  /** "home_address" → "Home address" */
  label(key: string): string {
    const text = key.replace(/^routine_/, '').replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  nameOf(id: string): string {
    return this.aboutMe.entitiesById().get(id)?.name ?? 'Someone';
  }

  sourceLabel(fact: ProfileFact): string {
    switch (fact.source.type) {
      case 'bot':
        return `Learned by ${fact.source.botName ?? 'a bot'}`;
      case 'contacts':
        return 'From your contact card';
      case 'calendar':
        return 'From your calendar';
      case 'location':
        return 'From your iPhone';
      case 'health':
        return 'From Health';
      default:
        return 'Added by you';
    }
  }

  async addPerson(): Promise<void> {
    const name = this.newPersonName().trim();
    if (!name) return;
    const relation = this.newPersonRelation().trim();
    await this.aboutMe.addPerson({
      kind: /\b(dog|cat|pet)\b/i.test(relation) ? 'pet' : 'person',
      name,
      ...(relation ? { relationToMe: relation } : {}),
    });
    this.newPersonName.set('');
    this.newPersonRelation.set('');
  }

  async removePerson(person: PersonView): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: `Remove ${person.entity.name}?`,
      message: 'Bots will forget this person and what they knew about them.',
      confirmLabel: 'Remove',
    });
    if (confirmed) await this.aboutMe.removePerson(person.entity.id);
  }

  async addRightNow(): Promise<void> {
    const me = this.me();
    const value = this.newNow().trim();
    if (!me || !value) return;
    const until = this.newNowUntil();
    await this.aboutMe.addFact({
      about: me.id,
      key: 'status',
      value,
      kind: 'current',
      ...(until ? { validUntil: new Date(`${until}T23:59:59`).toISOString() } : {}),
    });
    this.newNow.set('');
    this.newNowUntil.set('');
  }

  async addLasting(): Promise<void> {
    const me = this.me();
    const key = this.newFactKey().trim();
    const value = this.newFactValue().trim();
    if (!me || !key || !value) return;
    await this.aboutMe.addFact({ about: me.id, key, value, kind: 'lasting' });
    this.newFactKey.set('');
    this.newFactValue.set('');
  }

  startEdit(fact: ProfileFact): void {
    this.editingId.set(fact.id);
    this.editingValue.set(fact.value);
  }

  async saveEdit(fact: ProfileFact): Promise<void> {
    const value = this.editingValue().trim();
    if (value && value !== fact.value) await this.aboutMe.updateFact(fact.id, { value });
    this.editingId.set(null);
  }

  async deleteAll(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Delete About me?',
      message:
        'Bots forget everything about you and your people. It starts again with your next proactive bot.',
      confirmLabel: 'Delete',
    });
    if (confirmed) await this.aboutMe.deleteAll();
  }
}

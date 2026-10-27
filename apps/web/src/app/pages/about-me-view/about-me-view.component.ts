import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map } from 'rxjs';
import type { ProfileFact, ProfileRelation } from '@maple/shared';
import { AboutMeService } from '../../services/about-me.service';
import { PageService } from '../../services/page.service';
import { DialogService } from '../../components';

/** One row of the table: a fact, or how someone is related. */
export interface AboutMeRow {
  id: string;
  fact?: ProfileFact;
  relation?: ProfileRelation;
  who: string;
  what: string;
  value: string;
  /** ISO date-time; a fact with an end is a "current" one. */
  until: string | null;
  source: string;
  /** Learned by a bot: removing it is an undo. */
  learned: boolean;
  /** Waiting for approval. */
  pending: boolean;
}

/**
 * The About me page: one searchable table of what bots know about you in this notebook.
 * Each member sees only their own. Suggestions waiting for approval are pinned on top.
 */
@Component({
  selector: 'app-about-me-view',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './about-me-view.component.html',
  styleUrl: './about-me-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutMeViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly dialog = inject(DialogService);
  readonly aboutMe = inject(AboutMeService);

  private readonly pageId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly page = computed(
    () => this.pageService.pages().find((page) => page.id === this.pageId()) ?? null,
  );
  private readonly notebookId = computed(() => this.page()?.notebookId ?? null);

  readonly search = signal('');
  readonly whoFilter = signal('');
  readonly sourceFilter = signal('');
  readonly editingId = signal<string | null>(null);
  readonly editValue = signal('');
  readonly editUntil = signal('');
  readonly busy = signal(false);
  /** The last row removed, offered back with Undo. */
  readonly removed = signal<AboutMeRow | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly rows = computed<AboutMeRow[]>(() => {
    const profile = this.aboutMe.profile();
    if (!profile) return [];
    const me = profile.me;
    const name = (id: string) =>
      id === me?.id ? 'You' : (this.aboutMe.entitiesById().get(id)?.name ?? 'Someone');
    const factRow = (fact: ProfileFact, pending: boolean): AboutMeRow => ({
      id: fact.id,
      fact,
      who: name(fact.about),
      what: label(fact.key),
      value: fact.value,
      until: fact.validUntil ?? null,
      source: sourceLabel(fact.source),
      learned: fact.source.type === 'bot',
      pending,
    });
    const relationRow = (relation: ProfileRelation): AboutMeRow => ({
      id: relation.id,
      relation,
      who: name(relation.to),
      what: relation.from === me?.id ? 'Relationship' : `Relationship to ${name(relation.from)}`,
      value: label(relation.type),
      until: null,
      source: relation.source ? sourceLabel(relation.source) : 'Unknown',
      learned: relation.source?.type === 'bot',
      pending: false,
    });
    const byWho = (a: AboutMeRow, b: AboutMeRow) =>
      (a.who === 'You' ? 0 : 1) - (b.who === 'You' ? 0 : 1) ||
      a.who.localeCompare(b.who) ||
      a.what.localeCompare(b.what);
    return [
      ...profile.pending.map((fact) => factRow(fact, true)),
      ...[
        ...profile.facts.map((fact) => factRow(fact, false)),
        ...profile.relations.map(relationRow),
      ].sort(byWho),
    ];
  });

  readonly whoOptions = computed(() => distinct(this.rows().map((row) => row.who)));
  readonly sourceOptions = computed(() => distinct(this.rows().map((row) => row.source)));

  readonly filtered = computed(() => {
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    const who = this.whoFilter();
    const source = this.sourceFilter();
    return this.rows().filter((row) => {
      if (who && row.who !== who) return false;
      if (source && row.source !== source) return false;
      const text = [row.who, row.what, row.value, row.until?.slice(0, 10) ?? '', row.source]
        .join(' ')
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  readonly filtering = computed(() => !!(this.search() || this.whoFilter() || this.sourceFilter()));

  constructor() {
    // Load when the page's notebook is known; the load writes signals this doesn't read.
    effect(() => {
      const notebookId = this.notebookId();
      if (notebookId) untracked(() => void this.aboutMe.load(notebookId));
    });
  }

  startEdit(row: AboutMeRow): void {
    this.editingId.set(row.id);
    this.editValue.set(row.relation ? row.relation.type.replace(/_/g, ' ') : row.value);
    this.editUntil.set(row.until ? localDate(row.until) : '');
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(row: AboutMeRow): Promise<void> {
    const value = this.editValue().trim();
    if (!value) return;
    await this.act(async () => {
      if (row.relation) {
        if (value !== row.relation.type.replace(/_/g, ' '))
          await this.aboutMe.updateRelation(row.relation, value);
      } else if (row.fact) {
        const until = this.editUntil();
        const validUntil = until ? new Date(`${until}T23:59:59`).toISOString() : null;
        const changes = {
          ...(value !== row.fact.value ? { value } : {}),
          ...(validUntil !== (row.fact.validUntil ?? null) ? { validUntil } : {}),
        };
        if (Object.keys(changes).length) await this.aboutMe.updateFact(row.fact.id, changes);
      }
      this.editingId.set(null);
    });
  }

  async remove(row: AboutMeRow): Promise<void> {
    if (row.relation) {
      const confirmed = await this.dialog.confirm({
        title: 'Remove this relationship?',
        message: `Bots will no longer know how ${row.who} is related.`,
        confirmLabel: 'Remove',
      });
      if (confirmed) await this.act(() => this.aboutMe.removeRelation(row.relation!));
      return;
    }
    await this.act(async () => {
      await this.aboutMe.remove(row.fact!);
      this.removed.set(row);
    });
  }

  async undoRemove(): Promise<void> {
    const row = this.removed();
    if (!row?.fact) return;
    await this.act(async () => {
      await this.aboutMe.restore(row.fact!);
      this.removed.set(null);
    });
  }

  approve(row: AboutMeRow): Promise<void> {
    return this.act(() => this.aboutMe.approve(row.fact!));
  }

  dismiss(row: AboutMeRow): Promise<void> {
    return this.act(() => this.aboutMe.remove(row.fact!));
  }

  clearFilters(): void {
    this.search.set('');
    this.whoFilter.set('');
    this.sourceFilter.set('');
  }

  async removePage(): Promise<void> {
    const page = this.page();
    if (!page) return;
    const confirmed = await this.dialog.confirm({
      title: `Remove ${page.title}?`,
      message:
        'This moves the page to the trash. Bots in this notebook stop using About me; what was saved is kept and comes back if you restore the page.',
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    await this.act(async () => {
      await firstValueFrom(this.pageService.moveToTrash(page.id));
      await this.router.navigate(['/', page.notebookId]);
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
    } catch {
      this.actionError.set('That didn’t save. Check your connection and try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

/** "home_address" → "Home address" */
export function label(key: string): string {
  const text = key.replace(/^routine_/, '').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function sourceLabel(source: ProfileFact['source']): string {
  switch (source.type) {
    case 'bot':
      return source.botName ?? 'A bot';
    case 'contacts':
      return 'Contacts';
    case 'calendar':
      return 'Calendar';
    case 'location':
      return 'Places';
    case 'health':
      return 'Health';
    default:
      return 'You';
  }
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a === 'You' ? -1 : b === 'You' ? 1 : a.localeCompare(b),
  );
}

/** An ISO date-time as yyyy-mm-dd in this device's time zone, for a date input. */
function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

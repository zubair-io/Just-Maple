import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { followUpOwedBy, type FollowUp, type FollowUpAction } from '@maple/shared';
import { FollowUpsService } from '../../services/follow-ups.service';
import { PageService } from '../../services/page.service';

const DAY = 24 * 60 * 60;

export const FOLLOW_UP_KIND_LABELS: Record<FollowUp['direction'], string> = {
  you_promised: 'You promised',
  owe_reply: 'Reply owed',
  they_owe: 'They promised',
  waiting_reply: 'Waiting on reply',
};

/** The last done or dismiss, so it can be undone. */
interface LastAction {
  followUp: FollowUp;
  label: string;
}

/** When it's due: the stated date, or for unanswered questions, when they were said. */
function dueTime(followUp: FollowUp): number {
  return followUp.dueAt ?? followUp.at;
}

/**
 * The Follow-ups page: what you owe people and what they owe you, from your messages and
 * mail in this notebook's data pages. Each member sees only their own. Done, snooze and
 * dismiss on each, and a link to the message it came from.
 */
@Component({
  selector: 'app-follow-ups-view',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet],
  templateUrl: './follow-ups-view.component.html',
  styleUrl: './follow-ups-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowUpsViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  readonly service = inject(FollowUpsService);

  private readonly pageId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly page = computed(
    () => this.pageService.pages().find((page) => page.id === this.pageId()) ?? null,
  );
  private readonly notebookId = computed(() => this.page()?.notebookId ?? null);

  /** The follow-up whose snooze menu is open. */
  readonly snoozeFor = signal<string | null>(null);
  /** yyyy-mm-dd for a custom snooze. */
  readonly customDate = signal('');
  readonly busyId = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly lastAction = signal<LastAction | null>(null);
  readonly showSnoozed = signal(false);

  /** Now, in seconds, for "overdue" (refreshed with each load). */
  readonly now = signal(Math.floor(Date.now() / 1000));

  private readonly all = computed(() =>
    [...(this.service.list()?.followUps ?? [])].sort(
      (a, b) => dueTime(a) - dueTime(b) || a.at - b.at,
    ),
  );
  private readonly open = computed(() => this.all().filter((f) => f.status === 'open'));
  readonly youOwe = computed(() =>
    this.open().filter((f) => followUpOwedBy(f.direction) === 'you'),
  );
  readonly owedToYou = computed(() =>
    this.open().filter((f) => followUpOwedBy(f.direction) === 'them'),
  );
  readonly snoozed = computed(() => this.all().filter((f) => f.status === 'snoozed'));

  readonly summary = computed(() => {
    const count = this.open().length;
    const overdue = this.open().filter((f) => this.isOverdue(f)).length;
    const parts = [`${count} open`];
    if (overdue) parts.push(`${overdue} overdue`);
    if (this.snoozed().length) parts.push(`${this.snoozed().length} snoozed`);
    return parts.join(' · ');
  });

  constructor() {
    // Load when the page's notebook is known; the load writes signals this doesn't read.
    effect(() => {
      const notebookId = this.notebookId();
      if (notebookId) untracked(() => void this.reload(notebookId));
    });
  }

  private async reload(notebookId: string): Promise<void> {
    this.now.set(Math.floor(Date.now() / 1000));
    await this.service.load(notebookId);
  }

  kindLabel(followUp: FollowUp): string {
    return FOLLOW_UP_KIND_LABELS[followUp.direction];
  }

  isOverdue(followUp: FollowUp): boolean {
    return followUp.dueAt !== undefined && followUp.dueAt < this.now();
  }

  /** Seconds to a Date, for the date pipe. */
  date(seconds: number): Date {
    return new Date(seconds * 1000);
  }

  toggleSnooze(followUp: FollowUp): void {
    this.customDate.set('');
    this.snoozeFor.update((id) => (id === followUp.id ? null : followUp.id));
  }

  /** Snoozes for `days` days, or until the custom date's morning. */
  async snooze(followUp: FollowUp, days: number | 'custom'): Promise<void> {
    let until: Date;
    if (days === 'custom') {
      const day = this.customDate();
      if (!day) return;
      until = new Date(`${day}T08:00:00`);
      if (!(until.getTime() > Date.now())) {
        this.actionError.set('Pick a day after today.');
        return;
      }
    } else {
      until = new Date(Date.now() + days * DAY * 1000);
    }
    this.snoozeFor.set(null);
    await this.run(followUp, 'snooze', until.toISOString());
  }

  async done(followUp: FollowUp): Promise<void> {
    if (await this.run(followUp, 'done'))
      this.lastAction.set({ followUp, label: `Marked done: ${followUp.what}` });
  }

  async dismiss(followUp: FollowUp): Promise<void> {
    if (await this.run(followUp, 'dismiss'))
      this.lastAction.set({ followUp, label: `Dismissed: ${followUp.what}` });
  }

  /** Undoes the last done or dismiss, or wakes a snoozed one. */
  async reopen(followUp: FollowUp): Promise<void> {
    if (await this.run(followUp, 'reopen')) this.lastAction.set(null);
  }

  private async run(followUp: FollowUp, action: FollowUpAction, until?: string): Promise<boolean> {
    this.busyId.set(followUp.id);
    this.actionError.set(null);
    try {
      await this.service.act(followUp, action, until);
      return true;
    } catch (err) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.actionError.set(message || 'Could not update that follow-up. Try again.');
      return false;
    } finally {
      this.busyId.set(null);
    }
  }

  /** Opens the data page that shows the message or email it came from. */
  async openEvidence(followUp: FollowUp): Promise<void> {
    const notebookId = this.notebookId();
    const pageId = followUp.evidence[0]?.pageId;
    if (!notebookId || !pageId) return;
    await this.router.navigate(['/', notebookId, pageId]);
  }

  /** Tomorrow in yyyy-mm-dd, the earliest custom snooze. */
  readonly tomorrow = computed(() => {
    const date = new Date((this.now() + DAY) * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  });
}

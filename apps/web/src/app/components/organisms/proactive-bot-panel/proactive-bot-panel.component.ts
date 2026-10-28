import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { PROACTIVE_TIMING_DEFAULTS, type Page } from '@maple/shared';
import { NotebookService } from '../../../services/notebook.service';
import {
  ProactiveBotService,
  type MacDataHostStatus,
} from '../../../services/proactive-bot.service';

/**
 * Inline editor for making one shared bot a chat's proactive bot: its standing
 * instructions, plus whether the user's Mac is connected and what it watches.
 * Saving turns it on (replacing any other proactive bot in that chat).
 */
const SOURCE_NAMES: Record<string, string> = {
  imessage: 'Messages',
  mail: 'Mail',
  calendar: 'Calendar',
  contacts: 'Contacts',
  location: 'Places',
  health: 'Health',
};

/** How long news that can wait may be held, in minutes. */
const WAIT_CHOICES = [30, 60, 120, 240, 480];

function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

@Component({
  selector: 'app-proactive-bot-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './proactive-bot-panel.component.html',
  styleUrl: './proactive-bot-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProactiveBotPanelComponent {
  private readonly proactiveService = inject(ProactiveBotService);
  private readonly notebookService = inject(NotebookService);

  readonly page = input.required<Page>();
  readonly botId = input.required<string>();
  readonly closed = output<void>();

  readonly instructions = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<MacDataHostStatus | null>(null);
  /** A daily brief at this local time; off when empty. */
  readonly briefOn = signal(false);
  readonly briefTime = signal('07:30');
  /** Timing: tell every batch right away instead of holding what can wait. */
  readonly everyItem = signal(false);
  /** The longest news that can wait is held before a summary goes out. */
  readonly maxWaitMinutes = signal(PROACTIVE_TIMING_DEFAULTS.maxWaitMinutes);
  /** Quiet hours (owner's time zone): only urgent news goes out. */
  readonly quietOn = signal(PROACTIVE_TIMING_DEFAULTS.quietHours.enabled);
  readonly quietStart = signal(PROACTIVE_TIMING_DEFAULTS.quietHours.start);
  readonly quietEnd = signal(PROACTIVE_TIMING_DEFAULTS.quietHours.end);
  /** The wait choices, plus the saved one if it isn't among them. */
  readonly waitOptions = computed(() => {
    const current = this.maxWaitMinutes();
    const minutes = WAIT_CHOICES.includes(current)
      ? WAIT_CHOICES
      : [...WAIT_CHOICES, current].sort((a, b) => a - b);
    return minutes.map((value) => ({ value, label: waitLabel(value) }));
  });
  /** Other people can see this notebook, so they'll see what the bot posts. */
  readonly sharedWithOthers = computed(() => {
    const notebookId = this.page().notebookId;
    const sharing = this.notebookService.notebooks().find((n) => n._id === notebookId)?.sharing;
    // The owner is listed in sharedWith too.
    return (
      !!sharing?.isPublic || !!sharing?.sharedWith?.some((entry) => entry.accessLevel !== 'owner')
    );
  });

  /** This bot is already the chat's proactive bot (editing rather than turning on). */
  readonly isOn = computed(() => {
    const proactive = this.page().proactive;
    return !!proactive?.enabled && proactive.userBotId === this.botId();
  });
  readonly sourceNames = computed(() =>
    (this.status()?.sources ?? []).map((s) => SOURCE_NAMES[s] ?? s).join(', '),
  );

  constructor() {
    // Start from this bot's saved instructions, if it's the one already set.
    effect(() => {
      const proactive = this.page().proactive;
      const botId = this.botId();
      untracked(() => {
        const same = proactive?.userBotId === botId;
        this.instructions.set(same ? proactive.instructions : '');
        this.briefOn.set(same && !!proactive?.briefTime);
        this.briefTime.set((same && proactive?.briefTime) || '07:30');
        const saved = same ? proactive : undefined;
        const quiet = saved?.quietHours ?? PROACTIVE_TIMING_DEFAULTS.quietHours;
        this.everyItem.set(!!saved?.everyItem);
        this.maxWaitMinutes.set(saved?.maxWaitMinutes ?? PROACTIVE_TIMING_DEFAULTS.maxWaitMinutes);
        this.quietOn.set(quiet.enabled);
        this.quietStart.set(quiet.start);
        this.quietEnd.set(quiet.end);
        this.error.set(null);
      });
    });
    effect(() => {
      const notebookId = this.page().notebookId;
      if (!notebookId) return;
      // Only the notebook id is tracked; nothing read while loading re-runs this.
      untracked(() =>
        this.proactiveService.status(notebookId).then(
          (status) => this.status.set(status),
          () => this.status.set(null),
        ),
      );
    });
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.proactiveService.save(this.page().id, {
        userBotId: this.botId(),
        instructions: this.instructions().trim(),
        enabled: true,
        briefTime: this.briefOn() && this.briefTime() ? this.briefTime() : null,
        everyItem: this.everyItem(),
        maxWaitMinutes: this.maxWaitMinutes(),
        quietHours: {
          enabled: this.quietOn(),
          start: this.quietStart() || PROACTIVE_TIMING_DEFAULTS.quietHours.start,
          end: this.quietEnd() || PROACTIVE_TIMING_DEFAULTS.quietHours.end,
        },
      });
      this.closed.emit();
    } catch (err: unknown) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(message || 'Could not save the proactive bot.');
    } finally {
      this.saving.set(false);
    }
  }
}

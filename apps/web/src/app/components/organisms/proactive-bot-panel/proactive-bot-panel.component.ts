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
import type { Page } from '@maple/shared';
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

  readonly page = input.required<Page>();
  readonly botId = input.required<string>();
  readonly closed = output<void>();

  readonly instructions = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<MacDataHostStatus | null>(null);

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
        this.instructions.set(proactive?.userBotId === botId ? proactive.instructions : '');
        this.error.set(null);
      });
    });
    effect(() => {
      const notebookId = this.page().notebookId;
      if (!notebookId) return;
      this.proactiveService.status(notebookId).then(
        (status) => this.status.set(status),
        () => this.status.set(null),
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

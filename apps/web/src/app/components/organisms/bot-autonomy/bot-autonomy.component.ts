import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  autonomyChoices,
  BOT_ACTION_KIND_IDS,
  BOT_ACTION_KINDS,
  type BotActionKind,
  type BotAutonomy,
} from '@maple/shared';
import { BotActionService } from '../../../services/bot-action.service';

export const AUTONOMY_LABELS: Record<BotAutonomy, string> = {
  ask: 'Ask every time',
  auto: 'Do it and tell me',
  never: 'Never',
};

/**
 * What one bot may do without asking, per kind of action. "Do it and tell me" is only
 * offered where it's allowed (sending always asks), and only applies in the owner's
 * own private notebooks; the server enforces both.
 */
@Component({
  selector: 'app-bot-autonomy',
  standalone: true,
  templateUrl: './bot-autonomy.component.html',
  styleUrl: './bot-autonomy.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BotAutonomyComponent {
  readonly botId = input.required<string>();

  private readonly service = inject(BotActionService);

  readonly kinds = BOT_ACTION_KIND_IDS.map((id) => ({
    id,
    ...BOT_ACTION_KINDS[id],
    choices: autonomyChoices(id).map((value) => ({ value, label: AUTONOMY_LABELS[value] })),
  }));
  readonly settings = signal<Partial<Record<BotActionKind, BotAutonomy>>>({});
  readonly saving = signal<BotActionKind | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const botId = this.botId();
      untracked(() => void this.load(botId));
    });
  }

  async change(kind: BotActionKind, value: string): Promise<void> {
    const previous = this.settings();
    this.settings.set({ ...previous, [kind]: value as BotAutonomy });
    this.saving.set(kind);
    this.error.set(null);
    try {
      this.settings.set(await this.service.setAutonomy(this.botId(), kind, value as BotAutonomy));
    } catch {
      this.settings.set(previous);
      this.error.set('Could not save that. Check your connection and try again.');
    } finally {
      this.saving.set(null);
    }
  }

  private async load(botId: string): Promise<void> {
    try {
      const settings = await this.service.autonomy(botId);
      if (botId === this.botId()) this.settings.set(settings);
    } catch {
      this.error.set('Could not load what this bot may do.');
    }
  }
}

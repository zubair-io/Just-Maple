import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { BOT_ACTION_KINDS } from '@maple/shared';
import { BotActionService } from '../../../services/bot-action.service';

/**
 * "Done: … · Undo" for something a bot did without asking (its owner chose "Do it and
 * tell me"). Shows the saved summary, then the live state: doing → done, or failed /
 * undone. Only the owner gets Cancel (while it's still waiting) and Undo (for 24 hours).
 */
@Component({
  selector: 'app-action-receipt-card',
  standalone: true,
  templateUrl: './action-receipt-card.component.html',
  styleUrl: './action-receipt-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ActionReceiptCardComponent {
  readonly actionId = input.required<string>();
  readonly summary = input.required<string>();

  private readonly actions = inject(BotActionService);

  readonly action = computed(() => this.actions.actions()[this.actionId()] ?? null);
  readonly status = computed(() => this.action()?.status ?? null);
  readonly kind = computed(() => {
    const kind = this.action()?.kind;
    return kind ? BOT_ACTION_KINDS[kind] : null;
  });
  readonly undoing = computed(() => {
    const state = this.action()?.undo?.state;
    return state === 'queued' || state === 'delivered';
  });
  readonly notFound = computed(() => this.action()?.undo?.state === 'not_found');
  /** Cancelled while a Mac was already on it: undone once it's added. */
  readonly cancelling = computed(() => {
    const action = this.action();
    return !!action?.cancelRequestedAt && action.status !== 'denied' && action.status !== 'undone';
  });
  /** "on Mac two (…)" while undoing, when we know where. */
  readonly undoWhere = computed(() => {
    const undo = this.action()?.undo;
    if (!undo?.deviceName) return '';
    return undo.fallback
      ? ` on ${undo.deviceName} (the Mac that added it no longer collects your calendar)`
      : ` on ${undo.deviceName}`;
  });
  readonly tapping = signal(false);
  readonly tapError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.actionId();
      untracked(() => void this.actions.load(id));
    });
  }

  async undo(): Promise<void> {
    if (this.tapping() || !this.action()?.canUndo) return;
    this.tapping.set(true);
    this.tapError.set(null);
    try {
      await this.actions.undo(this.actionId());
    } catch (error) {
      this.tapError.set(error instanceof Error ? error.message : 'Could not undo it.');
    } finally {
      this.tapping.set(false);
    }
  }

  async cancel(): Promise<void> {
    if (this.tapping() || !this.action()?.canCancel) return;
    this.tapping.set(true);
    this.tapError.set(null);
    try {
      await this.actions.cancel(this.actionId());
    } catch (error) {
      this.tapError.set(error instanceof Error ? error.message : 'Could not cancel it.');
    } finally {
      this.tapping.set(false);
    }
  }
}

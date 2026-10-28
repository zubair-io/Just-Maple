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
import { DatePipe } from '@angular/common';
import {
  BOT_ACTION_KIND_IDS,
  BOT_ACTION_KINDS,
  type BotAction,
  type BotActionKind,
  type BotActionStatus,
} from '@maple/shared';
import { BotActionService } from '../../../services/bot-action.service';

export const ACTION_STATUS_LABELS: Record<BotActionStatus, string> = {
  proposed: 'Waiting for you',
  approved: 'Approved',
  denied: 'Not allowed',
  auto: 'Done without asking',
  queued: 'In progress',
  done: 'Done',
  failed: 'Failed',
  undone: 'Undone',
  expired: 'Expired',
};

/**
 * The action log, newest first: a bot's (in its settings) or a notebook's (its Activity
 * page). Filters by kind and status; the owner can undo what can still be undone. Other
 * members only get summaries of what was posted in the notebook's chats.
 */
@Component({
  selector: 'app-action-log',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './action-log.component.html',
  styleUrl: './action-log.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ActionLogComponent {
  readonly botId = input<string | null>(null);
  readonly notebookId = input<string | null>(null);

  private readonly service = inject(BotActionService);

  readonly kinds = BOT_ACTION_KIND_IDS.map((id) => ({ id, label: BOT_ACTION_KINDS[id].label }));
  readonly statuses = (Object.keys(ACTION_STATUS_LABELS) as BotActionStatus[]).map((id) => ({
    id,
    label: ACTION_STATUS_LABELS[id],
  }));
  readonly statusLabels = ACTION_STATUS_LABELS;

  readonly kind = signal<BotActionKind | ''>('');
  readonly status = signal<BotActionStatus | ''>('');
  private readonly ids = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly undoing = signal<string | null>(null);
  readonly undoError = signal<{ id: string; message: string } | null>(null);

  /** Rows as the service holds them, so cards and the list agree; filters re-applied. */
  readonly rows = computed(() => {
    const all = this.service.actions();
    const kind = this.kind();
    const status = this.status();
    return this.ids()
      .map((id) => all[id])
      .filter((row): row is BotAction => !!row)
      .filter((row) => (!kind || row.kind === kind) && (!status || row.status === status));
  });

  constructor() {
    effect(() => {
      const scope = { botId: this.botId(), notebookId: this.notebookId() };
      const filters = { kind: this.kind(), status: this.status() };
      untracked(() => void this.load(scope, filters));
    });
  }

  kindInfo(kind: BotActionKind) {
    return BOT_ACTION_KINDS[kind];
  }

  isUndoing(row: BotAction): boolean {
    return row.undo?.state === 'queued' || row.undo?.state === 'delivered';
  }

  /** The status, told apart where one status covers two cases. */
  statusLabel(row: BotAction): string {
    if (row.status === 'denied' && row.cancelRequestedAt) return 'Cancelled';
    if (row.status === 'done' && row.undo?.state === 'not_found')
      return "Couldn't find it on your Mac";
    return ACTION_STATUS_LABELS[row.status];
  }

  /** "on Mac two (…)" while undoing, when we know where. */
  undoWhere(row: BotAction): string {
    const undo = row.undo;
    if (!undo?.deviceName) return '';
    return undo.fallback
      ? ` on ${undo.deviceName} (the Mac that added it no longer collects your calendar)`
      : ` on ${undo.deviceName}`;
  }

  isCancelling(row: BotAction): boolean {
    return !!row.cancelRequestedAt && row.status !== 'denied' && row.status !== 'undone';
  }

  async cancel(row: BotAction): Promise<void> {
    if (this.undoing() || !row.canCancel) return;
    this.undoing.set(row.id);
    this.undoError.set(null);
    try {
      await this.service.cancel(row.id);
    } catch (error) {
      this.undoError.set({
        id: row.id,
        message: error instanceof Error ? error.message : 'Could not cancel it.',
      });
    } finally {
      this.undoing.set(null);
    }
  }

  async undo(row: BotAction): Promise<void> {
    if (this.undoing() || !row.canUndo) return;
    this.undoing.set(row.id);
    this.undoError.set(null);
    try {
      await this.service.undo(row.id);
    } catch (error) {
      this.undoError.set({
        id: row.id,
        message: error instanceof Error ? error.message : 'Could not undo it.',
      });
    } finally {
      this.undoing.set(null);
    }
  }

  private async load(
    scope: { botId: string | null; notebookId: string | null },
    filters: { kind: BotActionKind | ''; status: BotActionStatus | '' },
  ): Promise<void> {
    if (!scope.botId && !scope.notebookId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const rows = await this.service.list(
        scope.botId ? { botId: scope.botId } : { notebookId: scope.notebookId! },
        filters,
      );
      this.ids.set(rows.map((row) => row.id));
    } catch {
      this.error.set('Could not load the activity. Check your connection and try again.');
    } finally {
      this.loading.set(false);
    }
  }
}

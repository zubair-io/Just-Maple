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
import { formatEventTime, type CalendarEventDraft } from '@maple/shared';
import { CalendarProposalService } from '../../../services/calendar-proposal.service';
import { DeviceDataService } from '../../../services/device-data.service';

/**
 * A bot's "Add to calendar" offer. Shows the event the bot proposed (saved in the
 * message) and the live state: proposed → adding → added, or failed / expired. Only the
 * calendar's owner gets an active button; nothing is added until they tap it.
 */
@Component({
  selector: 'app-event-proposal-card',
  standalone: true,
  templateUrl: './event-proposal-card.component.html',
  styleUrl: './event-proposal-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class EventProposalCardComponent {
  readonly proposalId = input.required<string>();
  readonly event = input.required<CalendarEventDraft>();

  private readonly proposals = inject(CalendarProposalService);
  private readonly deviceData = inject(DeviceDataService);

  readonly proposal = computed(() => this.proposals.proposals()[this.proposalId()] ?? null);
  /** Before the state loads, the card shows the event without a button. */
  readonly status = computed(() => this.proposal()?.status ?? null);
  readonly canConfirm = computed(() => this.proposal()?.canConfirm === true);
  readonly when = computed(() => formatEventTime(this.event()));
  readonly tapping = signal(false);
  readonly tapError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.proposalId();
      untracked(() => void this.proposals.load(id));
    });
  }

  async add(): Promise<void> {
    if (this.tapping() || !this.canConfirm()) return;
    this.tapping.set(true);
    this.tapError.set(null);
    try {
      await this.proposals.confirm(this.proposalId());
    } catch (error) {
      this.tapError.set(error instanceof Error ? error.message : 'Could not add the event.');
    } finally {
      this.tapping.set(false);
    }
  }

  open(): void {
    const itemId = this.proposal()?.itemId;
    if (itemId) void this.deviceData.openItem(itemId);
  }
}

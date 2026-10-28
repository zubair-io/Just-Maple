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
import { describeHomeCall, type HomeServiceCall } from '@maple/shared';
import {
  HomeAcknowledgeNeeded,
  HomeProposalService,
} from '../../../services/home-proposal.service';

const ICONS: Record<string, string> = {
  light: 'lightbulb',
  switch: 'toggle_on',
  fan: 'mode_fan',
  cover: 'garage_door',
  climate: 'thermostat',
  lock: 'lock',
  media_player: 'speaker',
  scene: 'palette',
  script: 'play_circle',
};

/**
 * A bot's offer to change a Home Assistant device. Nothing happens until the home's owner
 * taps; unlocking or opening a garage door asks a second time. The owner's Mac does it,
 * after checking the device is still exposed.
 */
@Component({
  selector: 'app-home-proposal-card',
  standalone: true,
  templateUrl: './home-proposal-card.component.html',
  styleUrl: './home-proposal-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HomeProposalCardComponent {
  readonly proposalId = input.required<string>();
  readonly call = input.required<HomeServiceCall>();

  private readonly proposals = inject(HomeProposalService);

  readonly proposal = computed(() => this.proposals.proposals()[this.proposalId()] ?? null);
  readonly status = computed(() => this.proposal()?.status ?? null);
  readonly canConfirm = computed(() => this.proposal()?.canConfirm === true);
  readonly summary = computed(() => describeHomeCall(this.call()));
  readonly icon = computed(() => ICONS[this.call().domain] ?? 'home');
  /** Locks and garage doors: the first tap only arms the button. */
  readonly sensitive = computed(
    () => this.call().sensitive === true || this.proposal()?.call.sensitive === true,
  );
  readonly armed = signal(false);
  readonly tapping = signal(false);
  readonly tapError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.proposalId();
      untracked(() => void this.proposals.load(id));
    });
  }

  async tap(): Promise<void> {
    if (this.tapping() || !this.canConfirm()) return;
    this.tapError.set(null);
    if (this.sensitive() && !this.armed()) {
      this.armed.set(true);
      return;
    }
    this.tapping.set(true);
    try {
      await this.proposals.confirm(this.proposalId(), this.armed());
      this.armed.set(false);
    } catch (error) {
      if (error instanceof HomeAcknowledgeNeeded) {
        this.armed.set(true);
      } else {
        this.armed.set(false);
        this.tapError.set(error instanceof Error ? error.message : "Couldn't do that.");
      }
    } finally {
      this.tapping.set(false);
    }
  }

  cancel(): void {
    this.armed.set(false);
  }
}

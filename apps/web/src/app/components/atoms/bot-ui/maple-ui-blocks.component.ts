import {
  Component,
  InjectionToken,
  inject,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectTriggerAction } from '@openuidev/angular-lang';
import type { BotUIResponse, BotUIBlock } from '@maple/shared';
import { DeviceDataService } from '../../../services/device-data.service';
import { DEVICE_DATA_SOURCES } from '../../../utils/device-sources';
import { EventProposalCardComponent } from '../../molecules/event-proposal-card/event-proposal-card.component';

export const BOT_UI_DISABLED = new InjectionToken<() => boolean>('BOT_UI_DISABLED');

@Component({
  selector: 'app-maple-ui-blocks',
  standalone: true,
  imports: [FormsModule, EventProposalCardComponent],
  templateUrl: './maple-ui-blocks.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './maple-ui-blocks.component.scss',
})
export class MapleUIBlocksComponent {
  readonly props = input.required<Pick<BotUIResponse, 'blocks'>>();
  readonly renderNode = input<unknown>();
  readonly statementId = input<string>();
  readonly disabled = inject(BOT_UI_DISABLED);
  private readonly triggerAction = injectTriggerAction();
  readonly values = signal<Record<string, string>>({});
  /** Sources open the cited message, email, event or other item in its device data page. */
  private readonly deviceData = inject(DeviceDataService);
  openSource(itemId: string): void {
    void this.deviceData.openItem(itemId);
  }
  sourceIcon(itemId: string): string {
    const source = DEVICE_DATA_SOURCES.find((info) => itemId.startsWith(info.source + ':'));
    return source?.icon ?? 'description';
  }
  send(message: string): void {
    if (!this.disabled()) void this.triggerAction(message);
  }
  setValue(index: number, name: string, value: string): void {
    this.values.update((values) => ({ ...values, [index + ':' + name]: value.slice(0, 2000) }));
  }
  submit(block: Extract<BotUIBlock, { type: 'form' }>, index: number): void {
    const fields = block.fields
      .map((field) => `${field.label}: ${this.values()[index + ':' + field.name] || ''}`)
      .join('\n');
    this.send(`${block.title}\n${fields}`);
  }
}

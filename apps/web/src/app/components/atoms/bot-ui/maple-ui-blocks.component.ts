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

export const BOT_UI_DISABLED = new InjectionToken<() => boolean>('BOT_UI_DISABLED');

@Component({
  selector: 'app-maple-ui-blocks',
  standalone: true,
  imports: [FormsModule],
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

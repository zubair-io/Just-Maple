import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { botMessagePresentation, isBotUIFallbackContent, type Message } from '@maple/shared';
import { BotUIComponent } from '../bot-ui/bot-ui.component';
import { ContentRendererComponent } from '../content-renderer/content-renderer.component';

@Component({
  selector: 'app-bot-message-content',
  standalone: true,
  imports: [BotUIComponent, ContentRendererComponent],
  templateUrl: './bot-message-content.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotMessageContentComponent {
  readonly message =
    input.required<Pick<Message, 'senderType' | 'content' | 'botUI' | 'botResponseSource'>>();
  readonly disabled = input(false);
  readonly followUp = output<string>();
  readonly presentation = computed(() => botMessagePresentation(this.message()));
  readonly hideText = computed(() => {
    const { content, botUI } = this.presentation();
    return isBotUIFallbackContent(content, botUI);
  });
}

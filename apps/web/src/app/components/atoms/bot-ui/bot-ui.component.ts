import {
  Component,
  computed,
  forwardRef,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  Renderer,
  createLibrary,
  defineComponent,
  type ActionEvent,
} from '@openuidev/angular-lang';
import { Value } from '@sinclair/typebox/value';
import { BotUIResponseSchema, MAC_DATA_ITEM_ID_PATTERN, type BotUIResponse } from '@maple/shared';
import { z } from 'zod/v4';
import { BOT_UI_DISABLED, MapleUIBlocksComponent } from './maple-ui-blocks.component';

const text = z.string().max(10000);
const library = createLibrary({
  root: 'MapleResponse',
  components: [
    defineComponent({
      name: 'MapleResponse',
      description: 'Validated Maple message blocks.',
      component: MapleUIBlocksComponent,
      props: z.object({
        blocks: z
          .array(
            z.discriminatedUnion('type', [
              z.object({ type: z.literal('text'), content: text }),
              z.object({ type: z.literal('card'), title: text, content: text }),
              z.object({
                type: z.literal('table'),
                headers: z.array(text).max(20),
                rows: z.array(z.array(text).max(20)).max(100),
              }),
              z.object({
                type: z.literal('button'),
                label: text,
                message: z.string().min(1).max(2000),
              }),
              z.object({
                type: z.literal('form'),
                title: text,
                fields: z
                  .array(
                    z.object({
                      name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),
                      label: text,
                    }),
                  )
                  .max(12),
                submitLabel: text,
              }),
              z.object({
                type: z.literal('source'),
                label: z.string().max(200),
                itemId: z.string().regex(new RegExp(MAC_DATA_ITEM_ID_PATTERN)).max(400),
              }),
              z.object({
                type: z.literal('event_proposal'),
                proposalId: z.string().regex(/^[0-9a-f-]{36}$/),
                event: z.object({
                  title: z.string().min(1).max(200),
                  start: z.number(),
                  end: z.number(),
                  allDay: z.boolean().optional(),
                  location: z.string().max(500).optional(),
                  notes: z.string().max(2000).optional(),
                  timeZone: z.string().max(100).optional(),
                }),
              }),
            ]),
          )
          .min(1)
          .max(30),
      }),
    }),
  ],
});

@Component({
  selector: 'app-bot-ui',
  standalone: true,
  imports: [Renderer],
  providers: [
    {
      provide: BOT_UI_DISABLED,
      useFactory: (host: BotUIComponent) => () => host.disabled(),
      deps: [forwardRef(() => BotUIComponent)],
    },
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './bot-ui.component.html',
})
export class BotUIComponent {
  readonly response = input.required<BotUIResponse>();
  readonly disabled = input(false);
  readonly followUp = output<string>();
  readonly library = library;
  readonly renderFailed = signal(false);
  // Reconstruct static source from validated data, never evaluate raw model output in the browser.
  // This also renders replies saved before the Angular renderer was installed.
  readonly source = computed(() =>
    Value.Check(BotUIResponseSchema, this.response())
      ? `root = MapleResponse(${JSON.stringify(this.response().blocks)})`
      : null,
  );
  /** The renderer also emits an empty list after a clean render, which is not a failure. */
  onErrors(errors: unknown[]): void {
    this.renderFailed.set(errors.length > 0);
  }
  onAction(event: ActionEvent): void {
    if (!this.disabled() && event.type === 'continue_conversation' && event.humanFriendlyMessage) {
      this.followUp.emit(event.humanFriendlyMessage);
    }
  }
}

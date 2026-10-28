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
import { replyChannelName, replyComposeUrl, type ReplyDraftParams } from '@maple/shared';
import { BotActionService } from '../../../services/bot-action.service';

/**
 * A reply a bot drafted in the owner's voice, loaded from the saved row (never from what
 * the bot wrote). The owner sees who it's for, the message it answers and the draft,
 * which they can edit, copy, open in Messages or Mail, or discard. Opening is a
 * prefilled compose: they press send there; Maple never sends it. Everyone else in the
 * chat only sees that a reply was drafted.
 */
@Component({
  selector: 'app-reply-draft-card',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './reply-draft-card.component.html',
  styleUrl: './reply-draft-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ReplyDraftCardComponent {
  readonly actionId = input.required<string>();

  private readonly actions = inject(BotActionService);

  readonly action = computed(() => this.actions.actions()[this.actionId()] ?? null);
  /** Only the owner's row carries the draft. */
  readonly draft = computed(() => {
    const action = this.action();
    return action?.isOwner && action.params ? (action.params as unknown as ReplyDraftParams) : null;
  });
  readonly status = computed(() => this.action()?.status ?? null);
  readonly closed = computed(() => {
    const status = this.status();
    return status === 'discarded' || status === 'expired';
  });
  readonly channelName = computed(() => {
    const draft = this.draft();
    return draft ? replyChannelName(draft.channel) : '';
  });

  /** What's in the text box: the saved draft until the owner types. */
  readonly body = signal('');
  readonly edited = signal(false);
  readonly busy = signal(false);
  readonly copied = signal(false);
  readonly error = signal<string | null>(null);

  /** The prefilled compose for what's in the box, to the thread's own people. */
  readonly composeUrl = computed(() => {
    const draft = this.draft();
    const body = this.body().trim();
    return draft && body ? replyComposeUrl(draft, body) : null;
  });

  constructor() {
    effect(() => {
      const id = this.actionId();
      untracked(() => void this.actions.load(id));
    });
    // The box follows the saved draft until the owner types. Their edits then stay put,
    // even when a newer draft arrives; their save says which version it was based on.
    effect(() => {
      const action = this.action();
      const saved = this.draft()?.body;
      if (!action || saved === undefined) return;
      untracked(() => {
        if (!this.edited()) {
          this.body.set(saved);
          this.basedOn = action.updatedAt;
        } else if (this.conflicted) {
          // They were told it changed; saving again now keeps their text on purpose.
          this.basedOn = action.updatedAt;
          this.conflicted = false;
        }
      });
    });
  }

  /** The version of the draft the owner's text started from. */
  private basedOn: string | undefined;
  private conflicted = false;

  onInput(value: string): void {
    this.body.set(value);
    this.edited.set(true);
    this.copied.set(false);
  }

  /** The link itself opens Messages or Mail; this records it and saves the text. */
  onOpen(): void {
    const body = this.body().trim();
    if (!body || this.closed()) return;
    this.error.set(null);
    void this.actions
      .openDraft(this.actionId(), body)
      .then(({ action }) => {
        this.basedOn = action.updatedAt;
        this.edited.set(false);
      })
      .catch((error: unknown) => this.error.set(messageOf(error, 'Could not save the draft.')));
  }

  async copy(): Promise<void> {
    const body = this.body().trim();
    if (!body) return;
    this.error.set(null);
    try {
      await navigator.clipboard.writeText(body);
      this.copied.set(true);
    } catch {
      this.error.set("Couldn't copy. Select the text and copy it instead.");
      return;
    }
    if (this.edited() && !this.closed()) await this.save(body);
  }

  /** Saves the owner's edits when they leave the box. */
  async onBlur(): Promise<void> {
    const body = this.body().trim();
    if (this.edited() && body && !this.closed()) await this.save(body);
  }

  async discard(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.actions.discardDraft(this.actionId());
    } catch (error) {
      this.error.set(messageOf(error, 'Could not discard it.'));
    } finally {
      this.busy.set(false);
    }
  }

  private async save(body: string): Promise<void> {
    try {
      const action = await this.actions.saveDraft(this.actionId(), body, this.basedOn);
      this.basedOn = action.updatedAt;
      this.edited.set(false);
      this.error.set(null);
    } catch (error) {
      // Their text stays in the box; the newer draft is loaded behind it.
      this.conflicted = true;
      this.error.set(messageOf(error, 'Could not save your changes.'));
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

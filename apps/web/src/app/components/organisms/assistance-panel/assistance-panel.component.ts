import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  afterRenderEffect,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Router } from '@angular/router';
import {
  extractText,
  type AssistanceConversation,
  type AssistanceMessage,
  type AssistanceTask,
} from '@maple/shared';
import { AssistanceService, assistanceError } from '../../../services/assistance.service';
import { VoiceConversationService } from '../../../services/voice-conversation.service';
import { BotMessageContentComponent } from '../../atoms/bot-message-content/bot-message-content.component';
import { ChatViewport } from '../chat/chat-viewport';
import { NotebookService } from '../../../services/notebook.service';

@Component({
  selector: 'app-assistance-panel',
  host: { class: 'contents' },
  standalone: true,
  imports: [DatePipe, CdkTrapFocus, BotMessageContentComponent],
  providers: [VoiceConversationService],
  templateUrl: './assistance-panel.component.html',
  styleUrl: './assistance-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistancePanelComponent implements OnDestroy, AfterViewInit {
  readonly pageId = input<string | null>(null);
  readonly notebookId = input.required<string>();
  readonly conversationId = input<string | null>(null);
  readonly selection = input('');
  readonly closed = output<void>();
  private readonly api = inject(AssistanceService);
  private readonly router = inject(Router);
  private readonly notebooks = inject(NotebookService);
  readonly voice = inject(VoiceConversationService);
  readonly conversation = signal<AssistanceConversation | null>(null);
  readonly messages = signal<AssistanceMessage[]>([]);
  readonly tasks = signal<AssistanceTask[]>([]);
  readonly bots = signal<{ id: string; name: string; handle: string }[]>([]);
  readonly botId = signal('');
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly draft = signal('');
  readonly draftState = signal('');
  readonly conflictingDraft = signal<{ text: string; version: number } | null>(null);
  readonly error = signal<string | null>(null);
  readonly hasMore = signal(false);
  readonly voiceMode = signal(false);
  readonly saveNotebookId = signal('');
  readonly privateNotebooks = computed(() =>
    this.notebooks
      .notebooks()
      .filter((notebook) => !notebook.sharing.isPublic && notebook.sharing.sharedWith.length === 1),
  );
  readonly running = computed(() =>
    this.tasks().filter((task) => task.status === 'pending' || task.status === 'running'),
  );
  readonly failed = computed(() =>
    this.tasks().filter((task) => ['failed', 'interrupted', 'cancelled'].includes(task.status)),
  );
  readonly latest = signal(false);
  @ViewChild('viewport') private viewportRef?: ElementRef<HTMLElement>;
  @ViewChild('content') private contentRef?: ElementRef<HTMLElement>;
  private viewport?: ChatViewport;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private draftVersion = 0;
  private draftSaving = false;
  private pending?: { id: string; text: string; selection: string };
  private spokenFor?: string;
  private voiceTask?: string;
  private historyBusy = false;
  private destroyed = false;
  constructor() {
    effect(() => {
      const notebook = this.notebookId(),
        page = this.pageId(),
        conversation = this.conversationId();
      untracked(() => void this.initialize(notebook, page, conversation));
    });
    afterRenderEffect(() => {
      this.messages();
      this.running();
      this.viewport?.layoutChanged();
    });
  }
  ngAfterViewInit(): void {
    if (this.viewportRef && this.contentRef) {
      this.viewport = new ChatViewport(
        this.viewportRef.nativeElement,
        this.contentRef.nativeElement,
      );
      if (!this.loading()) this.viewport.completeInitialLoad();
    }
  }
  private async initialize(
    notebookId: string,
    pageId: string | null,
    conversationId: string | null,
  ): Promise<void> {
    void this.saveDraft();
    const generation = ++this.generation;
    clearInterval(this.timer);
    clearTimeout(this.draftTimer);
    this.voice.stop();
    this.viewport?.reset();
    this.voiceMode.set(false);
    this.voiceTask = undefined;
    this.conversation.set(null);
    this.messages.set([]);
    this.tasks.set([]);
    this.error.set(null);
    this.loading.set(true);
    this.draft.set('');
    this.pending = undefined;
    this.sending.set(false);
    this.conflictingDraft.set(null);
    try {
      const bots = await this.api.bots(notebookId);
      if (generation !== this.generation) return;
      this.bots.set(bots);
      this.botId.set(bots[0]?.id || '');
      this.saveNotebookId.set(
        this.privateNotebooks().find((notebook) => notebook._id === notebookId)?._id ||
          this.privateNotebooks()[0]?._id ||
          '',
      );
      if (conversationId) await this.loadConversation(conversationId, generation);
      else if (pageId && bots[0]) await this.openBot(bots[0].id);
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
        this.viewport?.completeInitialLoad();
      }
    }
  }
  async openBot(botId: string): Promise<void> {
    const pageId = this.pageId() || this.conversation()?.pageId;
    if (!pageId) return;
    await this.saveDraft();
    clearInterval(this.timer);
    this.voice.stop();
    this.voiceTask = undefined;
    this.conversation.set(null);
    this.messages.set([]);
    this.tasks.set([]);
    this.draft.set('');
    this.conflictingDraft.set(null);
    const generation = ++this.generation;
    this.botId.set(botId);
    this.error.set(null);
    this.loading.set(true);
    this.viewport?.reset();
    try {
      const conversation = await this.api.open(pageId, botId);
      if (generation === this.generation) await this.loadConversation(conversation.id, generation);
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
        this.viewport?.completeInitialLoad();
      }
    }
  }
  private async loadConversation(id: string, generation: number): Promise<void> {
    const history = await this.api.history(id);
    if (generation !== this.generation) return;
    this.conversation.set(history.conversation);
    this.botId.set(history.conversation.botId);
    this.messages.set(history.messages);
    this.tasks.set(history.tasks);
    this.hasMore.set(history.hasMore);
    this.draftVersion = history.conversation.draftVersion || 0;
    let local: string | null = null;
    try {
      local = localStorage.getItem(`assistance-draft:${id}`);
    } catch {
      /* Browser storage can be unavailable. */
    }
    this.draft.set(local ?? history.conversation.draft ?? '');
    try {
      const pending = JSON.parse(localStorage.getItem(`assistance-pending:${id}`) || 'null');
      if (
        pending &&
        typeof pending.id === 'string' &&
        typeof pending.text === 'string' &&
        typeof pending.selection === 'string'
      )
        this.pending = pending;
    } catch {
      /* A damaged local receipt is ignored. */
    }
    this.draftState.set(local !== null ? 'Recovered draft' : 'Saved');
    if (local !== null) this.draftTimer = setTimeout(() => void this.saveDraft(), 700);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.running().length) void this.refresh();
    }, 2500);
  }
  async refresh(): Promise<void> {
    const conversation = this.conversation();
    if (!conversation || this.historyBusy) return;
    const generation = this.generation;
    this.historyBusy = true;
    try {
      const history = await this.api.history(conversation.id);
      if (generation !== this.generation) return;
      const merged = new Map(
        [...this.messages(), ...history.messages].map((message) => [message.id, message]),
      );
      this.messages.set(
        [...merged.values()].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        ),
      );
      this.tasks.set(history.tasks);
      if (!this.conflictingDraft()) this.error.set(null);
      const response = history.messages.find(
        (message) => message.role === 'assistant' && message.taskId === this.voiceTask,
      );
      if (
        response &&
        this.voiceMode() &&
        this.voice.state() === 'idle' &&
        this.spokenFor !== response.id
      ) {
        this.spokenFor = response.id;
        this.readAloud(response);
      }
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      this.historyBusy = false;
    }
  }
  async earlier(): Promise<void> {
    const conversation = this.conversation(),
      before = this.messages()[0]?.id;
    if (!conversation || !before || this.loading()) return;
    const generation = this.generation;
    this.loading.set(true);
    try {
      const history = await this.api.history(conversation.id, before);
      if (generation !== this.generation) return;
      this.messages.set([
        ...new Map(
          [...history.messages, ...this.messages()].map((message) => [message.id, message]),
        ).values(),
      ]);
      this.hasMore.set(history.hasMore);
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  onDraft(text: string): void {
    this.draft.set(text);
    this.draftState.set('Unsaved');
    const id = this.conversation()?.id;
    if (id)
      try {
        localStorage.setItem(`assistance-draft:${id}`, text);
      } catch {
        /* The text stays in the composer. */
      }
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.saveDraft(), 700);
  }
  async saveDraft(): Promise<void> {
    const conversation = this.conversation();
    if (
      !conversation ||
      this.draftSaving ||
      this.conflictingDraft() ||
      this.draftState() === 'Saved'
    )
      return;
    const text = this.draft(),
      generation = this.generation;
    this.draftSaving = true;
    try {
      const saved = await this.api.saveDraft(conversation.id, text, this.draftVersion);
      if (generation !== this.generation) return;
      this.draftVersion = saved.draftVersion || 0;
      if (this.draft() === text) {
        this.draftState.set('Saved');
        try {
          localStorage.removeItem(`assistance-draft:${conversation.id}`);
        } catch {
          /* No local copy. */
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.draftState.set('Not synced — text kept here');
        this.error.set(assistanceError(error));
        if ((error as { status?: number })?.status === 409) {
          const history = await this.api.history(conversation.id).catch(() => null);
          if (history && generation === this.generation)
            this.conflictingDraft.set({
              text: history.conversation.draft || '',
              version: history.conversation.draftVersion || 0,
            });
        }
      }
    } finally {
      this.draftSaving = false;
      if (
        !this.destroyed &&
        !this.conflictingDraft() &&
        this.draftState() !== 'Saved' &&
        (generation !== this.generation || this.draft() !== text)
      ) {
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => void this.saveDraft(), 100);
      }
    }
  }
  async resolveDraft(keepMine: boolean): Promise<void> {
    const other = this.conflictingDraft();
    if (!other) return;
    this.draftVersion = other.version;
    this.conflictingDraft.set(null);
    this.error.set(null);
    if (!keepMine) this.onDraft(other.text);
    await this.saveDraft();
  }
  async send(): Promise<void> {
    const conversation = this.conversation(),
      text = this.draft().trim();
    if (!conversation || !text || this.sending()) return;
    const generation = this.generation;
    this.sending.set(true);
    this.error.set(null);
    const pending =
      this.pending?.text === text && this.pending.selection === this.selection()
        ? this.pending
        : { id: crypto.randomUUID(), text, selection: this.selection() };
    this.pending = pending;
    try {
      localStorage.setItem(`assistance-pending:${conversation.id}`, JSON.stringify(pending));
    } catch {
      /* Retry still works in this session. */
    }
    try {
      const task = await this.api.send(conversation.id, pending.id, text, pending.selection);
      if (generation !== this.generation) return;
      this.tasks.update((tasks) => [task, ...tasks.filter((row) => row.id !== task.id)]);
      this.pending = undefined;
      try {
        localStorage.removeItem(`assistance-pending:${conversation.id}`);
      } catch {
        /* The server still deduplicates this receipt. */
      }
      if (this.draft().trim() === text) {
        this.onDraft('');
        await this.saveDraft();
      }
      this.viewport?.followLatest();
      if (this.voiceMode()) this.voiceTask = task.id;
      await this.refresh();
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      if (generation === this.generation) this.sending.set(false);
    }
  }
  async stop(task: AssistanceTask): Promise<void> {
    try {
      await this.api.stop(task.id);
      await this.refresh();
    } catch (error) {
      this.error.set(assistanceError(error));
    }
  }
  async save(message: AssistanceMessage): Promise<void> {
    if (!message.taskId || !this.saveNotebookId()) return;
    try {
      const page = await this.api.saveResult(
        message.taskId,
        `From ${message.sourceTitle || 'conversation'}`,
        this.saveNotebookId(),
      );
      await this.router.navigate(['/', page.notebookId, page.id]);
      this.closed.emit();
    } catch (error) {
      this.error.set(assistanceError(error));
    }
  }
  presentation(message: AssistanceMessage) {
    return {
      ...message,
      senderType: message.role === 'assistant' ? ('bot' as const) : ('user' as const),
    };
  }
  async talk(): Promise<void> {
    this.voiceMode.set(true);
    this.error.set(null);
    try {
      if (this.voice.state() === 'listening') {
        const text = await this.voice.finish();
        if (text) {
          this.onDraft([this.draft().trim(), text].filter(Boolean).join('\n'));
          await this.send();
        }
      } else {
        this.voiceTask = undefined;
        await this.voice.start();
      }
    } catch (error) {
      this.voice.stop();
      this.error.set(assistanceError(error));
    }
  }
  readAloud(message: AssistanceMessage): void {
    this.voice.speak(extractText(message.content, { includeNewlines: true }));
  }
  scroll(): void {
    this.viewport?.scrolled();
    this.latest.set(this.viewport ? !this.viewport.atBottom : false);
  }
  bottom(): void {
    this.viewport?.followLatest();
    this.latest.set(false);
  }
  close(): void {
    void this.saveDraft();
    this.voice.stop();
    this.closed.emit();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    void this.saveDraft();
    this.generation++;
    clearInterval(this.timer);
    clearTimeout(this.draftTimer);
    this.voice.stop();
    this.viewport?.dispose();
  }
}

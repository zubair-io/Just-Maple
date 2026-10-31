import { Value } from '@sinclair/typebox/value';
import {
  CalendarEventDraftSchema,
  HomeServiceCallSchema,
  type CalendarEventDraft,
  type HomeServiceCall,
} from '@maple/shared';
import { EventProposalCardComponent } from '../../components/molecules/event-proposal-card/event-proposal-card.component';
import { HomeProposalCardComponent } from '../../components/molecules/home-proposal-card/home-proposal-card.component';
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  untracked,
  OnDestroy,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, firstValueFrom } from 'rxjs';
import { followUpsPageId } from '@maple/shared';
import { PageService } from '../../services/page.service';
import type {
  TodayFeed,
  TodaySection,
  FollowUp,
  FollowUpAction,
  AssistanceTask,
  BotAction,
} from '@maple/shared';
import { AssistanceService, assistanceError } from '../../services/assistance.service';
import { AssistancePanelComponent } from '../../components/organisms/assistance-panel/assistance-panel.component';
import { ReplyDraftCardComponent } from '../../components/molecules/reply-draft-card/reply-draft-card.component';
import { ActionReceiptCardComponent } from '../../components/molecules/action-receipt-card/action-receipt-card.component';

const empty = (): TodayFeed => ({ followUps: [], actions: [], tasks: [] });
@Component({
  selector: 'app-today-view',
  host: { class: 'flex flex-1 min-h-0 flex-col' },
  standalone: true,
  imports: [
    DatePipe,
    AssistancePanelComponent,
    ReplyDraftCardComponent,
    ActionReceiptCardComponent,
    EventProposalCardComponent,
    HomeProposalCardComponent,
  ],
  templateUrl: './today-view.component.html',
  styleUrl: './today-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodayViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AssistanceService);
  readonly pages = inject(PageService);
  readonly notebookId = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('notebookId') || '')),
    { initialValue: this.route.parent!.snapshot.paramMap.get('notebookId') || '' },
  );
  readonly section = signal<TodaySection>('needs-you');
  readonly sections: { id: TodaySection; label: string }[] = [
    { id: 'needs-you', label: 'Needs you' },
    { id: 'working', label: 'Working' },
    { id: 'review', label: 'Ready to review' },
    { id: 'recent', label: 'Recently completed' },
  ];
  readonly feed = signal<TodayFeed>(empty());
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly bots = signal<{ id: string; name: string; handle: string }[]>([]);
  readonly botId = signal('');
  readonly openConversation = signal<string | null>(null);
  private generation = 0;
  private loadedNotebook = '';
  private readonly requests = new Map<string, string>();
  private interval?: ReturnType<typeof setInterval>;
  constructor() {
    effect(() => {
      const notebook = this.notebookId(),
        section = this.section();
      untracked(() => {
        this.openConversation.set(null);
        if (notebook !== this.loadedNotebook) {
          this.loadedNotebook = notebook;
          this.bots.set([]);
          this.botId.set('');
          this.feed.set(empty());
        }
        void this.load(notebook, section);
      });
    });
    this.interval = setInterval(() => {
      if (document.visibilityState === 'visible' && this.section() === 'working' && !this.loading())
        void this.load(this.notebookId(), 'working', undefined, true);
    }, 5000);
  }
  async load(
    notebookId = this.notebookId(),
    section = this.section(),
    kind?: 'followUps' | 'actions' | 'tasks',
    quiet = false,
  ): Promise<void> {
    if (!notebookId) return;
    const generation = ++this.generation;
    if (!quiet) this.loading.set(true);
    this.error.set(null);
    const old = this.feed();
    const cursors: Record<string, string> = {};
    if (kind === 'followUps' && old.nextFollowUp) cursors['followBefore'] = old.nextFollowUp;
    if (kind === 'actions' && old.nextAction) cursors['actionBefore'] = old.nextAction;
    if (kind === 'tasks' && old.nextTask) cursors['taskBefore'] = old.nextTask;
    try {
      const [feed, bots] = await Promise.all([
        this.api.today(notebookId, section, cursors),
        !this.bots().length ? this.api.bots(notebookId) : Promise.resolve(this.bots()),
      ]);
      if (generation !== this.generation) return;
      this.bots.set(bots);
      if (!bots.some((bot) => bot.id === this.botId())) this.botId.set(bots[0]?.id || '');
      if (!kind) this.feed.set(feed);
      else if (kind === 'followUps')
        this.feed.set({
          ...old,
          followUps: [
            ...new Map([...old.followUps, ...feed.followUps].map((row) => [row.id, row])).values(),
          ],
          nextFollowUp: feed.nextFollowUp,
        });
      else if (kind === 'actions')
        this.feed.set({
          ...old,
          actions: [
            ...new Map([...old.actions, ...feed.actions].map((row) => [row.id, row])).values(),
          ],
          nextAction: feed.nextAction,
        });
      else
        this.feed.set({
          ...old,
          tasks: [...new Map([...old.tasks, ...feed.tasks].map((row) => [row.id, row])).values()],
          nextTask: feed.nextTask,
        });
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  select(section: TodaySection): void {
    this.feed.set(empty());
    this.section.set(section);
  }
  async act(row: FollowUp, action: FollowUpAction): Promise<void> {
    this.busy.set(row.id);
    try {
      await this.api.followUp(
        this.notebookId(),
        row.id,
        action,
        action === 'snooze' ? new Date(Date.now() + 86400_000).toISOString() : undefined,
      );
      await this.load();
    } catch (error) {
      this.error.set(assistanceError(error));
    } finally {
      this.busy.set(null);
    }
  }
  async draft(row: FollowUp): Promise<void> {
    if (!this.botId() || this.busy()) return;
    const generation = this.generation;
    this.busy.set(row.id);
    this.error.set(null);
    const key = row.id + this.botId();
    const requestId = this.requests.get(key) || crypto.randomUUID();
    this.requests.set(key, requestId);
    try {
      const result = await this.api.prepare(this.notebookId(), row.id, this.botId(), requestId);
      if (generation === this.generation) this.openConversation.set(result.conversation.id);
    } catch (error) {
      if (generation === this.generation) this.error.set(assistanceError(error));
    } finally {
      this.busy.set(null);
    }
  }
  source(row: FollowUp): void {
    const evidence = row.evidence[0];
    if (evidence?.pageId)
      void this.router.navigate(['/', this.notebookId(), evidence.pageId], {
        queryParams: { item: evidence.itemId },
      });
  }
  hasFollowUps(): boolean {
    return this.pages
      .pages()
      .some(
        (page) =>
          page.notebookId === this.notebookId() && page.type === 'followups' && !page.isTrashed,
      );
  }
  async enableFollowUps(): Promise<void> {
    this.busy.set('enable');
    try {
      await firstValueFrom(
        this.pages.createPage({
          id: followUpsPageId(this.notebookId()),
          type: 'followups',
          title: 'Follow-ups',
          notebookId: this.notebookId(),
        }),
      );
      await this.load();
    } catch (error) {
      this.error.set(assistanceError(error));
    } finally {
      this.busy.set(null);
    }
  }
  async stop(task: AssistanceTask): Promise<void> {
    try {
      await this.api.stop(task.id);
      await this.load();
    } catch (error) {
      this.error.set(assistanceError(error));
    }
  }
  eventDraft(action: BotAction): CalendarEventDraft | null {
    const event = action.params?.['event'];
    return action.kind === 'calendar_add' && Value.Check(CalendarEventDraftSchema, event)
      ? event
      : null;
  }
  homeCall(action: BotAction): HomeServiceCall | null {
    const call = action.params?.['call'] || action.params;
    return action.kind === 'home_service' && Value.Check(HomeServiceCallSchema, call) ? call : null;
  }
  openAction(action: BotAction): void {
    if (action.pageId) void this.router.navigate(['/', this.notebookId(), action.pageId]);
  }
  ngOnDestroy(): void {
    this.generation++;
    clearInterval(this.interval);
  }
}

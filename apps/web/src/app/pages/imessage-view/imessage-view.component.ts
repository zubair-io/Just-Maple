import {
  afterNextRender,
  ElementRef,
  Injector,
  viewChild,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import {
  MESSAGE_PLATFORM_NAMES,
  messagePlatform,
  type MacDataItem,
  type MessageConversation,
  type MessageHistoryQuery,
} from '@maple/shared';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { MessageArchiveImportComponent } from '../../components/organisms/device-data-panel/message-archive-import.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import { MessageHistoryService } from '../../services/message-history.service';

@Component({
  selector: 'app-imessage-view',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    DeviceDataPanelComponent,
    MessageArchiveImportComponent,
  ],
  templateUrl: './imessage-view.component.html',
  styleUrl: './imessage-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IMessageViewComponent {
  readonly list = injectDeviceDataList('imessage');
  private readonly api = inject(MessageHistoryService);
  private readonly injector = inject(Injector);
  readonly timeline = viewChild<ElementRef<HTMLElement>>('timeline');
  readonly search = signal('');
  readonly contactSearch = signal('');
  readonly platform = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly includeAutomated = signal(false);
  readonly kind = signal<'all' | 'person' | 'group'>('all');
  readonly conversations = signal<MessageConversation[]>([]);
  readonly platforms = signal<string[]>([]);
  readonly selected = signal<string | null>(null);
  readonly items = signal<MacDataItem[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly directoryLoading = signal(false);
  readonly error = signal('');
  readonly importOpen = signal(false);
  readonly showConversation = signal(false);
  readonly around = signal<string | undefined>(undefined);
  private readonly refreshVersion = signal(0);
  private readonly debouncedSearch = toSignal(toObservable(this.search).pipe(debounceTime(250)), {
    initialValue: '',
  });
  readonly platformNames = MESSAGE_PLATFORM_NAMES;
  readonly itemPlatform = messagePlatform;
  readonly query = computed<MessageHistoryQuery>(() => ({
    pageId: this.list.pageId() ?? undefined,
    search: this.debouncedSearch(),
    platform: this.platform(),
    from: this.dateBound(this.fromDate(), false),
    to: this.dateBound(this.toDate(), true),
    includeAutomated: this.includeAutomated(),
  }));
  readonly visibleConversations = computed(() => {
    const term = this.contactSearch().trim().toLocaleLowerCase();
    return this.conversations().filter(
      (c) =>
        (!term || c.name.toLocaleLowerCase().includes(term)) &&
        (this.kind() === 'all' ||
          (this.kind() === 'group' ? c.kind === 'group' : c.kind !== 'group')),
    );
  });
  readonly current = computed(() => this.conversations().find((c) => c.key === this.selected()));
  readonly canLoadEarlier = computed(() => this.offset() + this.items().length < this.total());
  private alive = true;
  private directoryRequest = 0;
  private messageRequest = 0;
  private previousPage: string | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
    });
    effect(() => {
      const query = this.query();
      this.refreshVersion();
      this.list.page()?.updatedAt;
      untracked(() => {
        if (query.pageId !== this.previousPage) {
          this.previousPage = query.pageId;
          this.selected.set(null);
          this.items.set([]);
          this.conversations.set([]);
          this.showConversation.set(false);
          this.messageRequest++;
        }
        void this.loadDirectory(query);
      });
    });
    effect(() => {
      const selected = this.selected();
      const query = this.query();
      const around = this.around();
      this.list.page()?.updatedAt;
      this.refreshVersion();
      untracked(() => {
        this.messageRequest++;
        this.items.set([]);
        this.total.set(0);
        this.offset.set(0);
        if (selected) void this.loadMessages({ ...query, conversation: selected, around });
      });
    });
  }
  private async loadDirectory(query: MessageHistoryQuery) {
    const request = ++this.directoryRequest;
    this.directoryLoading.set(true);
    this.error.set('');
    try {
      if (query.from !== undefined && query.to !== undefined && query.from > query.to)
        throw new Error('Choose an end date after the start date.');
      const result = await this.api.directory(query);
      if (!this.alive || request !== this.directoryRequest) return;
      this.conversations.set(result.conversations);
      this.platforms.set(result.platforms);
      if (this.selected() && !result.conversations.some((c) => c.key === this.selected())) {
        this.selected.set(null);
        this.items.set([]);
        this.total.set(0);
        this.messageRequest++;
      }
    } catch (error) {
      if (!this.alive || request !== this.directoryRequest) return;
      this.error.set(error instanceof Error ? error.message : 'Could not load conversations.');
      this.conversations.set([]);
      this.items.set([]);
      this.selected.set(null);
      this.messageRequest++;
    } finally {
      if (this.alive && request === this.directoryRequest) this.directoryLoading.set(false);
    }
  }
  private async loadMessages(query: MessageHistoryQuery, earlier = false) {
    const request = ++this.messageRequest;
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.api.messages({ ...query, limit: 100 });
      if (!this.alive || request !== this.messageRequest || query.conversation !== this.selected())
        return;
      const timeline = this.timeline()?.nativeElement;
      const oldHeight = timeline?.scrollHeight ?? 0;
      const oldTop = timeline?.scrollTop ?? 0;
      if (earlier) {
        const existing = new Set(this.items().map((item) => item.id));
        this.items.update((items) => [
          ...result.items.filter((item) => !existing.has(item.id)),
          ...items,
        ]);
      } else {
        this.items.set(result.items);
        this.offset.set(result.offset);
      }
      this.total.set(result.total);
      afterNextRender(
        () => {
          if (!this.alive || request !== this.messageRequest) return;
          const element = this.timeline()?.nativeElement;
          if (!element) return;
          const target = query.around
            ? [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(
                (row) => row.dataset['messageId'] === query.around,
              )
            : undefined;
          if (earlier) element.scrollTop = oldTop + element.scrollHeight - oldHeight;
          else if (target?.scrollIntoView) target.scrollIntoView({ block: 'center' });
          else element.scrollTop = element.scrollHeight;
        },
        { injector: this.injector },
      );
    } catch (error) {
      if (this.alive && request === this.messageRequest) {
        this.items.set([]);
        this.error.set(error instanceof Error ? error.message : 'Could not load messages.');
      }
    } finally {
      if (this.alive && request === this.messageRequest) this.loading.set(false);
    }
  }
  select(key: string) {
    this.around.set(undefined);
    this.selected.set(key);
    this.showConversation.set(true);
  }
  earlier() {
    const conversation = this.selected();
    const before = this.items()[0]?.id;
    if (conversation && before && !this.loading())
      void this.loadMessages({ ...this.query(), conversation, before }, true);
  }
  refresh() {
    this.list.refresh();
    this.refreshVersion.update((n) => n + 1);
  }
  context(item: MacDataItem) {
    this.around.set(item.id);
    this.search.set('');
  }
  latest() {
    this.around.set(undefined);
    this.refreshVersion.update((n) => n + 1);
  }
  private dateBound(value: string, end: boolean) {
    if (!value) return undefined;
    const at = new Date(`${value}T${end ? '23:59:59' : '00:00:00'}`).getTime() / 1000;
    return Number.isFinite(at) ? at : undefined;
  }
  day(item: MacDataItem) {
    return !item.occurredAt || item.extra?.['timestampUnknown']
      ? 'unknown'
      : new Date(item.occurredAt * 1000).toDateString();
  }
  initials(name: string) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toLocaleUpperCase();
  }
  highlight(body: string) {
    const term = this.debouncedSearch().trim();
    if (!term) return [{ text: body, match: false }];
    const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return body
      .split(new RegExp(`(${pattern})`, 'gi'))
      .map((text) => ({ text, match: text.toLocaleLowerCase() === term.toLocaleLowerCase() }));
  }
}

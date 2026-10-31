import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EMPTY, Subject, of } from 'rxjs';
import type { ChatEvent, Message, Thread } from '@maple/shared';
import { ThreadPanelComponent } from './thread-panel.component';
import { BotService } from '../../../../services/bot.service';
import { BotActivityService } from '../../../../services/bot-activity.service';
import { MessageService } from '../../../../services/message.service';
import { RealtimeService } from '../../../../services/realtime.service';

const message = (id: string) =>
  ({
    id,
    pageId: 'page',
    content: { type: 'doc', content: [] },
    createdAt: '2026-10-31T10:00:00Z',
  }) as Message;
describe('thread history races', () => {
  function setup() {
    const requests: Subject<{ thread: Thread; messages: Message[] }>[] = [];
    const events = new Subject<ChatEvent>();
    TestBed.configureTestingModule({
      imports: [ThreadPanelComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            notebookBotsCacheVersion: signal(0),
            getNotebookBots: () => of([]),
            getThreadForMessage: () => {
              const request = new Subject<{ thread: Thread; messages: Message[] }>();
              requests.push(request);
              return request;
            },
          },
        },
        { provide: BotActivityService, useValue: { inThreadBySource: signal(new Map()) } },
        { provide: MessageService, useValue: {} },
        { provide: RealtimeService, useValue: { events$: events, typing$: EMPTY } },
      ],
    });
    TestBed.overrideComponent(ThreadPanelComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(ThreadPanelComponent);
    fixture.componentRef.setInput('notebookId', 'notebook');
    fixture.componentRef.setInput('parentMessage', message('parent'));
    fixture.detectChanges();
    return { fixture, requests, events };
  }
  afterEach(() => TestBed.resetTestingModule());
  it('keeps replies arriving over realtime while its initial request is pending', () => {
    const { fixture, requests, events } = setup();
    events.next({
      action: 'thread_message',
      data: { parentMessageId: 'parent', message: message('live') },
    } as ChatEvent);
    requests[0].next({ thread: { _id: 'thread' } as Thread, messages: [message('earlier')] });
    expect(fixture.componentInstance.threadMessages().map((m) => m.id)).toEqual([
      'earlier',
      'live',
    ]);
    fixture.destroy();
  });
  it('cancels the previous thread load on navigation and exposes retryable failures', () => {
    const { fixture, requests } = setup();
    fixture.componentRef.setInput('parentMessage', message('other-parent'));
    fixture.detectChanges();
    requests[0].next({ thread: { _id: 'old' } as Thread, messages: [message('wrong')] });
    expect(fixture.componentInstance.threadMessages()).toEqual([]);
    requests[1].error(new Error('offline'));
    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(fixture.componentInstance.threadLoadError()).toContain('Could not load');
    fixture.componentInstance.retryThread();
    requests[2].next({ thread: { _id: 'new' } as Thread, messages: [message('correct')] });
    expect(fixture.componentInstance.threadMessages().map((m) => m.id)).toEqual(['correct']);
    expect(fixture.componentInstance.threadLoadError()).toBeNull();
    fixture.destroy();
  });
});

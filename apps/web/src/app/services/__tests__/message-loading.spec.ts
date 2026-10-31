import { BotService } from '../bot.service';
import { TestBed } from '@angular/core/testing';
import { effect, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { ChatEvent, Message, Page } from '@maple/shared';
import { MessageService } from '../message.service';
import { RealtimeService } from '../realtime.service';
import { RealtimeWSService } from '../realtime-ws.service';
import { IndexedDBService } from '../indexed-db.service';
import { NotificationService } from '../notification.service';
import { AuthService } from '../auth.service';
import { NetworkService } from '../network.service';
import { VisibilityService } from '../visibility.service';

const page = (id: string) => ({ id, notebookId: 'notebook', type: 'message' }) as Page;
const message = (id: string, pageId = 'a'): Message => ({
  _id: id,
  id,
  pageId,
  notebookId: 'notebook',
  userId: 'me',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] },
  createdAt: '2026-10-31T10:00:00Z',
  updatedAt: '2026-10-31T10:00:00Z',
});

describe('message history navigation and loading races', () => {
  let service: MessageService;
  let http: HttpTestingController;
  let events: Subject<ChatEvent>;
  let socket: { isConnected: ReturnType<typeof vi.fn>; sendChatMessage: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    events = new Subject();
    socket = { isConnected: vi.fn(() => false), sendChatMessage: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: IndexedDBService,
          useValue: { getAll: async () => [], putMany: async () => {}, delete: async () => {} },
        },
        { provide: RealtimeService, useValue: { events$: events, typing$: new Subject() } },
        { provide: RealtimeWSService, useValue: socket },
        { provide: AuthService, useValue: { user: () => ({ _id: 'me' }) } },
        { provide: NetworkService, useValue: { isOnline: () => true } },
        { provide: VisibilityService, useValue: { becameVisible$: new Subject() } },
        {
          provide: NotificationService,
          useValue: {
            setMessageUnreadCount: vi.fn(),
            onMessageNotificationRead: vi.fn(),
            onAllNotificationsRead: vi.fn(),
            activeNotebookId: () => 'notebook',
            markChatNotificationsRead: vi.fn(),
            scheduleUnreadRefresh: vi.fn(),
            showToast: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(MessageService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  const receive = (value: Message) =>
    events.next({
      action: 'message',
      data: value,
      notebookId: 'notebook',
      timestamp: value.createdAt,
    } as ChatEvent);
  function load(id = 'a') {
    service.loadMessagesByPageId(id).subscribe();
    http
      .expectOne(`/api/pages/${id}/messages`)
      .flush({ page: page(id), messages: [message(`first-${id}`, id)] });
  }
  it('does not make navigation effects reload when cached or live messages change', () => {
    const notebook = signal('notebook');
    const runs = vi.fn();
    const watcher = TestBed.runInInjectionContext(() =>
      effect(() => {
        runs();
        service.loadMessages(notebook()).subscribe();
      }),
    );
    TestBed.tick();
    http.expectOne('/api/notebooks/notebook/messages').flush({
      page: page('a'),
      messages: [message('initial')],
    });
    receive(message('live'));
    TestBed.tick();
    expect(runs).toHaveBeenCalledTimes(1);
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['initial', 'live']);
    watcher.destroy();
  });
  it('ignores a previous page response without changing the new page loading status', () => {
    service.loadMessagesByPageId('a').subscribe();
    const a = http.expectOne('/api/pages/a/messages');
    service.loadMessagesByPageId('b').subscribe();
    const b = http.expectOne('/api/pages/b/messages');
    a.flush({ page: page('a'), messages: [message('old')] });
    expect(service.currentPageId()).toBe('b');
    expect(service.isLoading()).toBe(true);
    b.flush({ page: page('b'), messages: [message('new', 'b')] });
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['new']);
    expect(service.isLoading()).toBe(false);
  });
  it('ignores older-history responses that arrive after navigation', () => {
    service.loadMessagesByPageId('a').subscribe();
    http.expectOne('/api/pages/a/messages').flush({
      page: page('a'),
      messages: Array.from({ length: 50 }, (_, i) => message(`a-${i}`)),
    });
    service.loadMore().subscribe();
    const older = http.expectOne((request) => request.url === '/api/pages/a/messages');
    service.loadMessagesByPageId('b').subscribe();
    older.flush({ messages: [message('older')] });
    expect(service.isLoading()).toBe(true);
    http
      .expectOne('/api/pages/b/messages')
      .flush({ page: page('b'), messages: [message('b', 'b')] });
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['b']);
  });
  it('does not mix another messages page in the same notebook into the selected page', () => {
    load('b');
    receive(message('wrong-page', 'a'));
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['first-b']);
  });
  it('retains a realtime message that arrives while the initial GET is in flight', () => {
    service.loadMessagesByPageId('a').subscribe();
    const request = http.expectOne('/api/pages/a/messages');
    receive(message('live'));
    request.flush({ page: page('a'), messages: [message('earlier')] });
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['earlier', 'live']);
  });
  it('keeps the selected page when sending over HTTP', () => {
    load('b');
    service.sendMessage('notebook', message('sent', 'b').content, { forceHttp: true }).subscribe();
    http.expectNone('/api/notebooks/notebook/messages');
    http.expectOne('/api/pages/b/messages').flush({ message: message('sent', 'b') });
    expect(service.messagesForTag().map((m) => m.id)).toEqual(['first-b', 'sent']);
  });
  it('includes the selected page in socket sends', () => {
    vi.useFakeTimers();
    load('b');
    socket.isConnected.mockReturnValue(true);
    const content = message('sent', 'b').content;
    service.sendMessage('notebook', content).subscribe();
    expect(socket.sendChatMessage).toHaveBeenCalledWith('notebook', content, 'b');
  });
});

describe('thread lookup errors', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IndexedDBService, useValue: {} },
      ],
    }),
  );
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it('distinguishes a new thread from a failed history request', () => {
    const service = TestBed.inject(BotService);
    const http = TestBed.inject(HttpTestingController);
    const result = vi.fn();
    service.getThreadForMessage('new').subscribe(result);
    http.expectOne('/api/messages/new/thread').flush({}, { status: 404, statusText: 'Not found' });
    expect(result).toHaveBeenCalledWith(null);
    const error = vi.fn();
    service.getThreadForMessage('existing').subscribe({ next: result, error });
    http
      .expectOne('/api/messages/existing/thread')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledOnce();
  });
});

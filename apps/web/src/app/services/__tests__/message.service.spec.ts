import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { MessageService } from '../message.service';
import { RealtimeService } from '../realtime.service';
import { RealtimeWSService } from '../realtime-ws.service';
import { IndexedDBService } from '../indexed-db.service';
import { NotificationService } from '../notification.service';
import { AuthService } from '../auth.service';
import { NetworkService } from '../network.service';
import { VisibilityService } from '../visibility.service';
import { Subject, firstValueFrom, of } from 'rxjs';
import type { Message, ChatEvent, NoteContent } from '@maple/shared';

describe('MessageService', () => {
  let service: MessageService;
  let httpMock: HttpTestingController;
  let realtimeEventsSubject: Subject<ChatEvent>;
  let mockIndexedDB: Partial<IndexedDBService>;
  let mockRealtimeService: Partial<RealtimeService>;
  let mockNotificationService: Partial<NotificationService>;
  let messageNotificationReadCallback: ((notebookId: string, pageId?: string) => void) | null =
    null;

  const mockMessage: Message = {
    _id: 'msg-1',
    id: 'msg-1-uuid',
    notebookId: 'tag-1',
    pageId: 'page-1',
    userId: 'user-1',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    realtimeEventsSubject = new Subject<ChatEvent>();
    messageNotificationReadCallback = null;

    mockIndexedDB = {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      putMany: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    mockRealtimeService = {
      sendTyping: vi.fn(),
      events$: realtimeEventsSubject.asObservable(),
      typing$: new Subject().asObservable(),
      status: vi.fn(),
    };

    mockNotificationService = {
      setMessageUnreadCount: vi.fn(),
      onMessageNotificationRead: vi.fn((callback) => {
        messageNotificationReadCallback = callback;
      }),
      markNotebookMessagesAsRead: vi.fn(),
      markPageMessagesAsRead: vi.fn(),
      showToast: vi.fn(),
      activeNotebookId: vi.fn(() => null),
    };

    const mockRealtimeWSService = {
      isConnected: vi.fn(() => false),
      sendChatMessage: vi.fn(),
    };

    const mockAuthService = {
      user: vi.fn(() => ({ _id: 'user-1', email: 'test@example.com' })),
    };

    const mockNetworkService = {
      isOnline: vi.fn(() => true),
    };

    const mockVisibilityService = {
      becameVisible$: new Subject().asObservable(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        MessageService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: IndexedDBService, useValue: mockIndexedDB },
        { provide: RealtimeService, useValue: mockRealtimeService },
        { provide: RealtimeWSService, useValue: mockRealtimeWSService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: NetworkService, useValue: mockNetworkService },
        { provide: VisibilityService, useValue: mockVisibilityService },
      ],
    });

    service = TestBed.inject(MessageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadMessages', () => {
    it('should load messages for a tag', async () => {
      const messages = [mockMessage];

      service.loadMessages('tag-1').subscribe((result) => {
        expect(result).toEqual(messages);
        expect(service.messagesForTag()).toEqual(messages);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      expect(req.request.method).toBe('GET');
      req.flush({ messages });
    });

    it('should set currentTagId when loading messages', async () => {
      service.loadMessages('tag-1').subscribe(() => {
        // Verify the currentTagId is set by checking messagesForTag filter works
        expect(service.messagesForTag().length).toBe(1);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      req.flush({ messages: [mockMessage] });
    });

    it('should handle errors', async () => {
      service.loadMessages('tag-1').subscribe({
        next: (result) => {
          expect(result).toEqual([]);
          expect(service.error()).toBe('Failed to load messages');
          done();
        },
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      req.flush({ error: 'Failed to load messages' }, { status: 500, statusText: 'Server Error' });
    });
  });

  describe('sendMessage', () => {
    it('should send a message and update store', async () => {
      const content: NoteContent = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
      };

      // First load messages to set currentTagId
      service.loadMessages('tag-1').subscribe();
      const loadReq = httpMock.expectOne('/api/notebooks/tag-1/messages');
      loadReq.flush({ messages: [] });

      service.sendMessage('tag-1', content).subscribe((result) => {
        expect(result).toEqual(mockMessage);
        expect(service.messagesForTag().some((m) => m.id === mockMessage.id)).toBe(true);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ content });
      req.flush({ message: mockMessage });
    });

    it('should perform optimistic update', () => {
      const content: NoteContent = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
      };

      // First load messages to set currentTagId
      service.loadMessages('tag-1').subscribe();
      const loadReq = httpMock.expectOne('/api/notebooks/tag-1/messages');
      loadReq.flush({ messages: [] });

      service.sendMessage('tag-1', content).subscribe();

      // Should have temp message before response
      const messages = service.messagesForTag();
      expect(messages.some((m) => m.id.startsWith('temp-'))).toBe(true);

      // Complete the request
      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      req.flush({ message: mockMessage });
    });

    it('should rollback on error', async () => {
      const content: NoteContent = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
      };

      // First load messages to set currentTagId
      service.loadMessages('tag-1').subscribe();
      const loadReq = httpMock.expectOne('/api/notebooks/tag-1/messages');
      loadReq.flush({ messages: [] });

      service.sendMessage('tag-1', content).subscribe({
        error: () => {
          // Temp message should be removed
          const messages = service.messagesForTag();
          expect(messages.some((m) => m.id.startsWith('temp-'))).toBe(false);
          done();
        },
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      req.flush({ error: 'Failed' }, { status: 500, statusText: 'Server Error' });
    });
  });

  describe('realtime events', () => {
    beforeEach((done) => {
      // Load messages to set currentTagId
      service.loadMessages('tag-1').subscribe(() => done());
      const req = httpMock.expectOne('/api/notebooks/tag-1/messages');
      req.flush({ messages: [] });
    });

    it('should add message from realtime event for current tag', () => {
      const newMessage: Message = {
        ...mockMessage,
        _id: 'msg-2',
      };

      realtimeEventsSubject.next({
        action: 'message',
        data: newMessage,
        notebookId: 'tag-1',
        userId: 'user-2',
        timestamp: new Date().toISOString(),
      });

      expect(service.messagesForTag().some((m) => m.id === 'msg-2')).toBe(true);
    });

    it('should ignore message from realtime event for different tag', () => {
      const newMessage: Message = {
        ...mockMessage,
        _id: 'msg-2',
        notebookId: 'tag-2', // Different tag
      };

      realtimeEventsSubject.next({
        action: 'message',
        data: newMessage,
        notebookId: 'tag-2',
        userId: 'user-2',
        timestamp: new Date().toISOString(),
      });

      expect(service.messagesForTag().some((m) => m.id === 'msg-2')).toBe(false);
    });

    it('should update message from realtime edited event', () => {
      // First add a message
      service.loadMessages('tag-1').subscribe();
      const loadReq = httpMock.expectOne('/api/notebooks/tag-1/messages');
      loadReq.flush({ messages: [mockMessage] });

      const editedMessage: Message = {
        ...mockMessage,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] }],
        },
        editedAt: new Date().toISOString(),
      };

      realtimeEventsSubject.next({
        action: 'edited',
        data: editedMessage,
        notebookId: 'tag-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const message = service.messagesForTag().find((m) => m.id === mockMessage.id);
      expect(message?.editedAt).toBeDefined();
    });

    it('should remove message from realtime deleted event', () => {
      // First add a message
      service.loadMessages('tag-1').subscribe();
      const loadReq = httpMock.expectOne('/api/notebooks/tag-1/messages');
      loadReq.flush({ messages: [mockMessage] });

      realtimeEventsSubject.next({
        action: 'deleted',
        data: { id: mockMessage.id },
        notebookId: 'tag-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(service.messagesForTag().some((m) => m.id === mockMessage.id)).toBe(false);
    });
  });

  describe('unread counts', () => {
    it('should load unread counts', async () => {
      const counts = [
        { notebookId: 'tag-1', count: 5 },
        { notebookId: 'tag-2', count: 3 },
      ];

      service.loadUnreadCounts().subscribe((result) => {
        expect(result).toEqual(counts);
        expect(service.getUnreadCount('tag-1')).toBe(5);
        expect(service.getUnreadCount('tag-2')).toBe(3);
        expect(service.getUnreadCount('tag-unknown')).toBe(0);
        done();
      });

      const req = httpMock.expectOne('/api/unread');
      expect(req.request.method).toBe('GET');
      req.flush({ counts });
    });

    it('should mark tag as read', async () => {
      // First load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({ counts: [{ notebookId: 'tag-1', count: 5 }] });

      service.markAsRead('tag-1').subscribe(() => {
        expect(service.getUnreadCount('tag-1')).toBe(0);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/read');
      expect(req.request.method).toBe('POST');
      req.flush({ lastReadAt: new Date().toISOString() });
    });
  });

  describe('centralized notification integration', () => {
    it('should compute totalMessageUnreadCount from all pages', () => {
      // Load unread counts for multiple pages
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [
          { pageId: 'page-1', notebookId: 'tag-1', count: 5 },
          { pageId: 'page-2', notebookId: 'tag-2', count: 3 },
          { pageId: 'page-3', notebookId: 'tag-1', count: 2 },
        ],
      });

      expect(service.totalMessageUnreadCount()).toBe(10);
    });

    it('should sync message unread count with NotificationService', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [{ pageId: 'page-1', notebookId: 'tag-1', count: 5 }],
      });

      // Should have called setMessageUnreadCount with the total
      expect(mockNotificationService.setMessageUnreadCount).toHaveBeenCalledWith(5);
    });

    it('should provide hasUnreadByPageId helper', () => {
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [{ pageId: 'page-1', notebookId: 'tag-1', count: 5 }],
      });

      expect(service.hasUnreadByPageId('page-1')).toBe(true);
      expect(service.hasUnreadByPageId('page-unknown')).toBe(false);
    });

    it('should provide hasUnreadByNotebookId helper', () => {
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [{ pageId: 'page-1', notebookId: 'tag-1', count: 5 }],
      });

      expect(service.hasUnreadByNotebookId('tag-1')).toBe(true);
      expect(service.hasUnreadByNotebookId('tag-unknown')).toBe(false);
    });

    it('should skip API call when marking as read with no unread messages', () => {
      // Don't load any unread counts (empty)
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({ counts: [] });

      // Try to mark as read when there are no unread
      service.markAsRead('tag-1').subscribe();

      // Should not make any API call
      httpMock.expectNone('/api/notebooks/tag-1/read');
    });

    it('should skip API call when marking page as read with no unread messages', () => {
      // Don't load any unread counts (empty)
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({ counts: [] });

      // Try to mark as read when there are no unread
      service.markAsReadByPageId('page-1').subscribe();

      // Should not make any API call
      httpMock.expectNone('/api/pages/page-1/read');
    });

    it('should call NotificationService.markNotebookMessagesAsRead when marking notebook as read', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [{ pageId: 'page-1', notebookId: 'tag-1', count: 5 }],
      });

      // Mark notebook as read
      service.markAsRead('tag-1').subscribe();
      const req = httpMock.expectOne('/api/notebooks/tag-1/read');
      req.flush({ lastReadAt: new Date().toISOString() });

      // Should sync with notification service
      expect(mockNotificationService.markNotebookMessagesAsRead).toHaveBeenCalledWith('tag-1');
    });

    it('should call NotificationService.markPageMessagesAsRead when marking page as read', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [{ pageId: 'page-1', notebookId: 'tag-1', count: 5 }],
      });

      // Mark page as read
      service.markAsReadByPageId('page-1').subscribe();
      const req = httpMock.expectOne('/api/pages/page-1/read');
      req.flush({ lastReadAt: new Date().toISOString() });

      // Should sync with notification service
      expect(mockNotificationService.markPageMessagesAsRead).toHaveBeenCalledWith('page-1');
    });

    it('should clear unread count when notification callback is triggered for page', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [
          { pageId: 'page-1', notebookId: 'tag-1', count: 5 },
          { pageId: 'page-2', notebookId: 'tag-2', count: 3 },
        ],
      });

      expect(service.getUnreadCountByPageId('page-1')).toBe(5);

      // Simulate notification panel marking page messages as read
      messageNotificationReadCallback?.('tag-1', 'page-1');

      // Should clear unread for that page
      expect(service.getUnreadCountByPageId('page-1')).toBe(0);
      // Other pages should remain
      expect(service.getUnreadCountByPageId('page-2')).toBe(3);
    });

    it('should clear unread count when notification callback is triggered for notebook', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [
          { pageId: 'page-1', notebookId: 'tag-1', count: 5 },
          { pageId: 'page-2', notebookId: 'tag-1', count: 3 },
          { pageId: 'page-3', notebookId: 'tag-2', count: 2 },
        ],
      });

      expect(service.totalMessageUnreadCount()).toBe(10);

      // Simulate notification panel marking notebook messages as read (no pageId)
      messageNotificationReadCallback?.('tag-1');

      // Should clear unread for all pages in that notebook
      expect(service.getUnreadCount('tag-1')).toBe(0);
      // Other notebooks should remain
      expect(service.getUnreadCountByPageId('page-3')).toBe(2);
    });

    it('should update totalMessageUnreadCount after marking as read', () => {
      // Load unread counts
      service.loadUnreadCounts().subscribe();
      const countsReq = httpMock.expectOne('/api/unread');
      countsReq.flush({
        counts: [
          { pageId: 'page-1', notebookId: 'tag-1', count: 5 },
          { pageId: 'page-2', notebookId: 'tag-2', count: 3 },
        ],
      });

      expect(service.totalMessageUnreadCount()).toBe(8);

      // Mark page as read
      service.markAsReadByPageId('page-1').subscribe();
      const req = httpMock.expectOne('/api/pages/page-1/read');
      req.flush({ lastReadAt: new Date().toISOString() });

      // Total should decrease
      expect(service.totalMessageUnreadCount()).toBe(3);
    });
  });
});

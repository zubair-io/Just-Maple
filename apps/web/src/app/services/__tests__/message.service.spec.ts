import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { MessageService } from '../message.service';
import { RealtimeService } from '../realtime.service';
import { IndexedDBService } from '../indexed-db.service';
import { Subject, firstValueFrom } from 'rxjs';
import type { Message, ChatEvent, NoteContent } from '@maple/shared';

describe('MessageService', () => {
  let service: MessageService;
  let httpMock: HttpTestingController;
  let realtimeEventsSubject: Subject<ChatEvent>;
  let mockIndexedDB: Partial<IndexedDBService>;
  let mockRealtimeService: Partial<RealtimeService>;

  const mockMessage: Message = {
    _id: 'msg-1',
    id: 'msg-1-uuid',
    notebookId: 'tag-1',
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

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        MessageService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: IndexedDBService, useValue: mockIndexedDB },
        { provide: RealtimeService, useValue: mockRealtimeService },
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
});

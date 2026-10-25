import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { NotificationService } from '../notification.service';
import { NativeBridgeService } from '../native-bridge.service';
import { IndexedDBService } from '../indexed-db.service';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import type { Notification } from '@maple/shared';

describe('NotificationService', () => {
  let service: NotificationService;
  let httpMock: HttpTestingController;
  let mockNativeBridge: Partial<NativeBridgeService>;
  let mockIndexedDB: Partial<IndexedDBService>;
  let mockRouter: Partial<Router>;

  const mockNotification: Notification = {
    _id: 'notif-1',
    userId: 'user-1',
    type: 'message_received',
    data: {
      notebookId: 'notebook-1',
      pageId: 'page-1',
      senderName: 'Test User',
      messagePreview: 'Hello world',
    },
    read: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockReadNotification: Notification = {
    ...mockNotification,
    _id: 'notif-2',
    read: true,
  };

  beforeEach(() => {
    mockNativeBridge = {
      isNativeApp: vi.fn(() => false),
      setBadge: vi.fn(),
      onPushPermissionResult: vi.fn(() => new Subject().asObservable()),
      onPushStatus: vi.fn(() => new Subject().asObservable()),
      onNotificationTapped: vi.fn(() => new Subject().asObservable()),
      onForegroundNotification: vi.fn(() => new Subject().asObservable()),
      onPushUnregistered: vi.fn(() => new Subject().asObservable()),
      requestPushPermission: vi.fn(),
      getPushStatus: vi.fn(),
      unregisterPushNotifications: vi.fn(),
    };

    mockIndexedDB = {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      putMany: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        NotificationService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: NativeBridgeService, useValue: mockNativeBridge },
        { provide: IndexedDBService, useValue: mockIndexedDB },
        { provide: Router, useValue: mockRouter },
      ],
    });

    service = TestBed.inject(NotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('Elf store management', () => {
    it('should fetch and store notifications', () => {
      const notifications = [mockNotification, mockReadNotification];

      service.fetchNotifications().subscribe(() => {
        expect(service.notifications()).toEqual(notifications);
      });

      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      expect(req.request.method).toBe('GET');
      req.flush({ notifications });
    });

    it('should persist notifications to IndexedDB', () => {
      const notifications = [mockNotification];

      service.fetchNotifications().subscribe(() => {
        expect(mockIndexedDB.putMany).toHaveBeenCalledWith(notifications, 'notification');
      });

      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications });
    });

    it('should add notification via addNotification method', () => {
      service.addNotification(mockNotification);
      expect(service.notifications()).toContainEqual(mockNotification);
    });
  });

  describe('unread count computation', () => {
    it('should compute unreadNotificationCount correctly', () => {
      const notifications = [mockNotification, mockReadNotification];

      service.fetchNotifications().subscribe(() => {
        expect(service.unreadNotificationCount()).toBe(1);
      });

      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications });
    });

    it('should not add unread messages on top of notifications (each message has one)', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification] }); // 1 unread notification

      service.setMessageUnreadCount(5);

      expect(service.totalUnreadCount()).toBe(1);
      expect(service.messageUnreadCount()).toBe(5);
    });

    it('should use the server total, which includes notifications not loaded here', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification], unreadCount: 98 });

      expect(service.unreadNotificationCount()).toBe(98);
      expect(service.totalUnreadCount()).toBe(98);
    });

    it('should refresh the count from the server', () => {
      service.refreshUnreadCount();

      const req = httpMock.expectOne('/api/notifications/unread-count');
      req.flush({ unreadCount: 4 });

      expect(service.unreadNotificationCount()).toBe(4);
    });

    it('should count a newly added unread notification once', () => {
      service.refreshUnreadCount();
      httpMock.expectOne('/api/notifications/unread-count').flush({ unreadCount: 2 });

      service.addNotification({ ...mockNotification, _id: 'notif-new' });
      service.addNotification({ ...mockNotification, _id: 'notif-new' });

      expect(service.unreadNotificationCount()).toBe(3);
    });
  });

  describe('mark as read', () => {
    it('should mark notification as read', () => {
      // First fetch notifications
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockNotification] });

      expect(service.unreadNotificationCount()).toBe(1);

      // Mark as read
      service.markAsRead('notif-1').subscribe(() => {
        expect(service.unreadNotificationCount()).toBe(0);
      });

      const req = httpMock.expectOne('/api/notifications/notif-1/read');
      expect(req.request.method).toBe('PATCH');
      req.flush({ message: 'OK' });
    });

    it('should skip API call if notification already read', () => {
      // Fetch already-read notification
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockReadNotification] });

      // Try to mark as read
      service.markAsRead('notif-2').subscribe();

      // Should not make API call
      httpMock.expectNone('/api/notifications/notif-2/read');
    });

    it('should take the server count and clear the chat’s other notifications', () => {
      service.fetchNotifications().subscribe();
      httpMock.expectOne('/api/notifications?limit=50&skip=0').flush({
        notifications: [mockNotification, { ...mockNotification, _id: 'notif-3' }],
        unreadCount: 10,
      });

      service.markAsRead('notif-1').subscribe();
      httpMock
        .expectOne('/api/notifications/notif-1/read')
        .flush({ message: 'OK', unreadNotificationCount: 8 });

      expect(service.unreadNotificationCount()).toBe(8);
      expect(service.notifications().find((n) => n._id === 'notif-3')?.read).toBe(true);
    });

    it('should trigger callback when message_received notification is marked as read', () => {
      const callbackMock = vi.fn();
      service.onMessageNotificationRead(callbackMock);

      // Fetch notifications
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockNotification] });

      // Mark as read
      service.markAsRead('notif-1').subscribe();
      const req = httpMock.expectOne('/api/notifications/notif-1/read');
      req.flush({ message: 'OK' });

      // Callback should be called with notebook and page IDs
      expect(callbackMock).toHaveBeenCalledWith('notebook-1', 'page-1');
    });

    it('should mark all notifications as read', () => {
      const unreadNotifications = [
        mockNotification,
        { ...mockNotification, _id: 'notif-3', read: false },
      ];

      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: unreadNotifications });

      expect(service.unreadNotificationCount()).toBe(2);

      service.markAllAsRead().subscribe(() => {
        expect(service.unreadNotificationCount()).toBe(0);
      });

      const req = httpMock.expectOne('/api/notifications/read-all');
      expect(req.request.method).toBe('PATCH');
      req.flush({ message: 'OK', count: 2 });
    });

    it('should skip markAllAsRead API call if no unread notifications', () => {
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockReadNotification], unreadCount: 0 });

      service.markAllAsRead().subscribe();

      // Should not make API call
      httpMock.expectNone('/api/notifications/read-all');
    });

    it('should call markAllAsRead when only older, unloaded notifications are unread', () => {
      const onAllRead = vi.fn();
      service.onAllNotificationsRead(onAllRead);
      service.fetchNotifications().subscribe();
      httpMock
        .expectOne('/api/notifications?limit=50&skip=0')
        .flush({ notifications: [mockReadNotification], unreadCount: 40 });

      service.markAllAsRead().subscribe();
      httpMock
        .expectOne('/api/notifications/read-all')
        .flush({ message: 'OK', count: 40, unreadNotificationCount: 0 });

      expect(service.unreadNotificationCount()).toBe(0);
      expect(onAllRead).toHaveBeenCalled();
    });
  });

  describe('reading a chat', () => {
    const chatNotifications: Notification[] = [
      mockNotification, // notebook-1 / page-1
      { ...mockNotification, _id: 'notif-3', data: { notebookId: 'notebook-1', pageId: 'page-2' } },
      { ...mockNotification, _id: 'notif-4', data: { notebookId: 'notebook-1' } }, // older: no pageId
      { ...mockNotification, _id: 'notif-5', data: { notebookId: 'notebook-2', pageId: 'page-3' } },
    ];

    function load() {
      service.fetchNotifications().subscribe();
      httpMock
        .expectOne('/api/notifications?limit=50&skip=0')
        .flush({ notifications: chatNotifications, unreadCount: 4 });
    }

    const readIds = () =>
      service
        .notifications()
        .filter((n) => n.read)
        .map((n) => n._id)
        .sort();

    it('marks that chat’s notifications read and takes the server count, without extra API calls', () => {
      load();

      service.markChatNotificationsRead({ notebookId: 'notebook-1', pageId: 'page-1' }, 2);

      expect(readIds()).toEqual(['notif-1', 'notif-4']);
      expect(service.unreadNotificationCount()).toBe(2);
      // The server already cleared them as part of the read; no per-notification calls
      httpMock.expectNone((req) => req.url.includes('/read'));
    });

    it('lowers the count by what it marked when the server sent no count', () => {
      load();

      service.markChatNotificationsRead({ pageId: 'page-3' });

      expect(readIds()).toEqual(['notif-5']);
      expect(service.unreadNotificationCount()).toBe(3);
    });
  });

  describe('badge sync', () => {
    beforeEach(() => {
      // Enable native app mode
      (mockNativeBridge.isNativeApp as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it('should sync badge count with native app on fetch', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification] });

      expect(mockNativeBridge.setBadge).toHaveBeenCalledWith(1);
    });

    it('should set the badge to the server count after a chat is read', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification], unreadCount: 7 });

      vi.clearAllMocks();
      service.markChatNotificationsRead({ notebookId: 'notebook-1', pageId: 'page-1' }, 6);

      expect(mockNativeBridge.setBadge).toHaveBeenCalledWith(6);
    });

    it('should sync badge after marking as read', () => {
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockNotification] });

      vi.clearAllMocks();

      service.markAsRead('notif-1').subscribe();
      const req = httpMock.expectOne('/api/notifications/notif-1/read');
      req.flush({ message: 'OK' });

      expect(mockNativeBridge.setBadge).toHaveBeenCalledWith(0);
    });

    it('should clear badge', () => {
      service.clearBadge();
      expect(mockNativeBridge.setBadge).toHaveBeenCalledWith(0);
    });

    it('should not call setBadge when not native app', () => {
      (mockNativeBridge.isNativeApp as ReturnType<typeof vi.fn>).mockReturnValue(false);

      service.syncBadgeCount();

      expect(mockNativeBridge.setBadge).not.toHaveBeenCalled();
    });
  });

  describe('toast management', () => {
    it('should show toast notification', () => {
      service.showToast({
        title: 'Test',
        message: 'Test message',
        type: 'info',
      });

      expect(service.toasts().length).toBe(1);
      expect(service.toasts()[0].title).toBe('Test');
      expect(service.toasts()[0].message).toBe('Test message');
    });

    it('should remove toast notification', () => {
      service.showToast({
        title: 'Test',
        message: 'Test message',
        type: 'info',
      });

      const toastId = service.toasts()[0].id;
      service.removeToast(toastId);

      expect(service.toasts().length).toBe(0);
    });
  });

  describe('active notebook tracking', () => {
    it('should set and get active notebook ID', () => {
      expect(service.activeNotebookId()).toBeNull();

      service.setActiveNotebook('notebook-1');
      expect(service.activeNotebookId()).toBe('notebook-1');

      service.setActiveNotebook(null);
      expect(service.activeNotebookId()).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('should provide unreadCount as alias for unreadNotificationCount', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification] });

      // Both should return the same value
      expect(service.unreadCount()).toBe(service.unreadNotificationCount());
      expect(service.unreadCount()).toBe(1);
    });
  });
});

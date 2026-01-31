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

    it('should compute totalUnreadCount including messages', () => {
      const notifications = [mockNotification]; // 1 unread notification

      service.fetchNotifications().subscribe(() => {
        // Set message unread count
        service.setMessageUnreadCount(5);

        // Total should be notifications + messages
        expect(service.totalUnreadCount()).toBe(6);
      });

      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications });
    });

    it('should update totalUnreadCount when message count changes', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [] });

      service.setMessageUnreadCount(3);
      expect(service.totalUnreadCount()).toBe(3);

      service.setMessageUnreadCount(7);
      expect(service.totalUnreadCount()).toBe(7);

      service.setMessageUnreadCount(0);
      expect(service.totalUnreadCount()).toBe(0);
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
      fetchReq.flush({ notifications: [mockReadNotification] });

      service.markAllAsRead().subscribe();

      // Should not make API call
      httpMock.expectNone('/api/notifications/read-all');
    });
  });

  describe('notebook/page messages mark as read', () => {
    it('should mark notebook message notifications as read', () => {
      const notebookNotifications = [
        mockNotification,
        {
          ...mockNotification,
          _id: 'notif-3',
          data: { notebookId: 'notebook-1', pageId: 'page-2' },
        },
        {
          ...mockNotification,
          _id: 'notif-4',
          data: { notebookId: 'notebook-2', pageId: 'page-3' },
        },
      ];

      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: notebookNotifications });

      expect(service.unreadNotificationCount()).toBe(3);

      // Mark notebook-1 messages as read
      service.markNotebookMessagesAsRead('notebook-1');

      // Should mark 2 notifications (notif-1 and notif-3) as read
      expect(service.unreadNotificationCount()).toBe(1);

      // Should fire API calls in background
      const req1 = httpMock.expectOne('/api/notifications/notif-1/read');
      const req3 = httpMock.expectOne('/api/notifications/notif-3/read');
      req1.flush({ message: 'OK' });
      req3.flush({ message: 'OK' });
    });

    it('should mark page message notifications as read', () => {
      const pageNotifications = [
        mockNotification, // page-1
        {
          ...mockNotification,
          _id: 'notif-3',
          data: { notebookId: 'notebook-1', pageId: 'page-2' },
        },
      ];

      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: pageNotifications });

      expect(service.unreadNotificationCount()).toBe(2);

      // Mark page-1 messages as read
      service.markPageMessagesAsRead('page-1');

      // Should mark 1 notification as read
      expect(service.unreadNotificationCount()).toBe(1);

      // Should fire API call in background
      const req = httpMock.expectOne('/api/notifications/notif-1/read');
      req.flush({ message: 'OK' });
    });

    it('should skip if no unread notifications for notebook', () => {
      service.fetchNotifications().subscribe();
      const fetchReq = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      fetchReq.flush({ notifications: [mockReadNotification] });

      service.markNotebookMessagesAsRead('notebook-1');

      // Should not make any API calls
      httpMock.expectNone('/api/notifications/notif-2/read');
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

    it('should sync badge count including message unread count', () => {
      service.fetchNotifications().subscribe();
      const req = httpMock.expectOne('/api/notifications?limit=50&skip=0');
      req.flush({ notifications: [mockNotification] }); // 1 notification

      // Reset mock to check next call
      vi.clearAllMocks();

      // Add message unread count
      service.setMessageUnreadCount(5);

      // Badge should include both: 1 notification + 5 messages = 6
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

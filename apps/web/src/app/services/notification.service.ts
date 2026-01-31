import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, take, Observable, map, tap, of } from 'rxjs';
import { nanoid } from 'nanoid';
import { createStore } from '@ngneat/elf';
import {
  withEntities,
  selectAllEntities,
  setEntities,
  updateEntities,
  upsertEntities,
  getAllEntities,
} from '@ngneat/elf-entities';
import { toSignal } from '@angular/core/rxjs-interop';
import { NativeBridgeService } from './native-bridge.service';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import type { Notification, NotificationListResponse, DeviceRegistration } from '@maple/shared';
import type { ToastData } from '../components/atoms/toast/toast.component';
import { Router } from '@angular/router';

const STORE_NAME = DB_STORES.NOTIFICATION;

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly router = inject(Router);
  private readonly indexedDB = inject(IndexedDBService);

  // Elf Store for notifications
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Notification, '_id'>({ idKey: '_id' }),
  );

  // Observable selectors
  private readonly notifications$ = this.store.pipe(selectAllEntities());

  // Signal wrapper for notifications from Elf store
  private readonly _notificationsSignal = toSignal(this.notifications$, {
    initialValue: [] as Notification[],
  });

  // Public signals
  readonly notifications = computed(() => this._notificationsSignal() ?? []);
  readonly unreadNotificationCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );

  // Message unread count (set by MessageService to avoid circular dependency)
  private readonly _messageUnreadCount = signal(0);
  readonly messageUnreadCount = this._messageUnreadCount.asReadonly();

  // Total unread count (notifications + messages) for badge
  readonly totalUnreadCount = computed(
    () => this.unreadNotificationCount() + this._messageUnreadCount(),
  );

  // Legacy alias for backward compatibility
  readonly unreadCount = this.unreadNotificationCount;

  readonly isRequestingPermission = signal(false);
  readonly permissionGranted = signal(false);
  readonly isRegistered = signal(false);
  readonly serverId = signal<string | null>(null);

  // Toast notifications
  readonly toasts = signal<ToastData[]>([]);

  // Current active notebook (for smart toast filtering)
  readonly activeNotebookId = signal<string | null>(null);

  // Callback for when message_received notifications are marked as read
  private _onMessageNotificationRead: ((notebookId: string, pageId?: string) => void) | null = null;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Hydrate from IndexedDB
    await this.hydrateFromIndexedDB();

    if (this.nativeBridge.isNativeApp()) {
      // Listen for push permission result
      this.nativeBridge.onPushPermissionResult().subscribe((response) => {
        this.permissionGranted.set(response.granted);
        this.isRequestingPermission.set(false);

        if (response.granted) {
          // Fetch push status after permission granted
          this.checkPushStatus();
        }
      });

      // Listen for push status updates
      this.nativeBridge.onPushStatus().subscribe((response) => {
        this.isRegistered.set(response.isRegistered);
        this.serverId.set(response.serverId || null);
      });

      // Listen for notification taps
      this.nativeBridge.onNotificationTapped().subscribe((notification) => {
        this.handleNotificationTap(notification);
      });

      // Listen for foreground notifications
      this.nativeBridge.onForegroundNotification().subscribe((notification) => {
        this.handleForegroundNotification(notification);
      });

      // Check initial push status
      await this.checkPushStatus();
    }
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    try {
      const cached = await this.indexedDB.getAll<Notification>(STORE_NAME);
      if (cached.length > 0 && this.store.query(getAllEntities()).length === 0) {
        this.store.update(setEntities(cached));
      }
    } catch {
      // Silently fail - IndexedDB hydration is non-critical
    }
  }

  private async persistToIndexedDB(notifications: Notification[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || notifications.length === 0) return;
    try {
      await this.indexedDB.putMany(notifications, STORE_NAME);
    } catch {
      // Silently fail
    }
  }

  // MARK: - Message Unread Count Integration

  /**
   * Set the message unread count (called by MessageService)
   * This keeps the notification service aware of total unread messages
   */
  setMessageUnreadCount(count: number): void {
    this._messageUnreadCount.set(count);
    this.syncBadgeCount();
  }

  /**
   * Register callback for when message_received notifications are marked as read
   * This allows MessageService to sync its unread counts
   */
  onMessageNotificationRead(callback: (notebookId: string, pageId?: string) => void): void {
    this._onMessageNotificationRead = callback;
  }

  // MARK: - Push Notification Registration

  /**
   * Request push notification permissions (iOS only)
   */
  async requestPushPermission(): Promise<boolean> {
    if (!this.nativeBridge.isNativeApp()) {
      return false;
    }

    this.isRequestingPermission.set(true);

    this.nativeBridge.requestPushPermission();

    try {
      const response = await firstValueFrom(
        this.nativeBridge.onPushPermissionResult().pipe(take(1)),
      );

      this.permissionGranted.set(response.granted);

      if (response.granted) {
        await this.checkPushStatus();
      }

      return response.granted;
    } catch {
      return false;
    } finally {
      this.isRequestingPermission.set(false);
    }
  }

  /**
   * Check current push notification registration status
   * Verifies with server to ensure registration is valid
   */
  async checkPushStatus(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return;
    }

    // Get local status first
    this.nativeBridge.getPushStatus();

    try {
      const localResponse = await firstValueFrom(this.nativeBridge.onPushStatus().pipe(take(1)));

      // Verify with server to ensure registration actually exists in database
      const devices = await firstValueFrom(this.getDevices());
      const hasServerRegistration = devices.length > 0;

      // Use server state as source of truth
      this.isRegistered.set(hasServerRegistration);
      this.serverId.set(localResponse.serverId || null);
    } catch {
      // Silently fail - push status check is non-critical
    }
  }

  /**
   * Unregister from push notifications
   */
  async unregisterPushNotifications(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return;
    }

    // Tell native app to unregister (it will call the API and clear local state)
    this.nativeBridge.unregisterPushNotifications();

    // Wait for response
    const response = await firstValueFrom(this.nativeBridge.onPushUnregistered().pipe(take(1)));

    if (response.success) {
      // Clear web app state
      this.isRegistered.set(false);
      this.serverId.set(null);
    } else {
      throw new Error(response.error || 'Failed to unregister');
    }
  }

  // MARK: - Notification History

  /**
   * Fetch notification history from server
   */
  fetchNotifications(limit = 50, skip = 0): Observable<void> {
    return this.http
      .get<NotificationListResponse>('/api/notifications', {
        params: { limit: limit.toString(), skip: skip.toString() },
      })
      .pipe(
        tap((response) => {
          this.store.update(setEntities(response.notifications));
          this.persistToIndexedDB(response.notifications);
          // Sync badge count with native app
          this.syncBadgeCount();
        }),
        map(() => void 0),
      );
  }

  /**
   * Fetch a single notification by ID
   */
  fetchNotification(id: string, apiUrl?: string): Observable<Notification> {
    const url = apiUrl ? `${apiUrl}/api/notifications/${id}` : `/api/notifications/${id}`;
    return this.http
      .get<{ notification: Notification }>(url)
      .pipe(map((response) => response.notification));
  }

  /**
   * Mark notification as read
   */
  markAsRead(id: string): Observable<void> {
    const notification = this.notifications().find((n) => n._id === id);

    // Skip if already read
    if (notification?.read) {
      return of(void 0);
    }

    return this.http.patch<{ message: string }>(`/api/notifications/${id}/read`, {}).pipe(
      tap(() => {
        // Update local state
        this.store.update(updateEntities(id, { read: true }));

        // If this is a message_received notification, notify MessageService to sync
        if (notification?.type === 'message_received' && this._onMessageNotificationRead) {
          const notebookId = notification.data['notebookId'];
          const pageId = notification.data['pageId'];
          if (notebookId) {
            this._onMessageNotificationRead(notebookId, pageId);
          }
        }

        // Sync badge count with native app
        this.syncBadgeCount();
      }),
      map(() => void 0),
    );
  }

  /**
   * Sync the badge count with the native app
   * Uses total unread count (notifications + messages)
   */
  syncBadgeCount(): void {
    if (this.nativeBridge.isNativeApp()) {
      this.nativeBridge.setBadge(this.totalUnreadCount());
    }
  }

  /**
   * Clear the badge (set to 0)
   */
  clearBadge(): void {
    if (this.nativeBridge.isNativeApp()) {
      this.nativeBridge.setBadge(0);
    }
  }

  /**
   * Mark all notifications as read
   */
  markAllAsRead(): Observable<void> {
    const unreadNotifications = this.notifications().filter((n) => !n.read);

    // Skip if no unread notifications
    if (unreadNotifications.length === 0) {
      return of(void 0);
    }

    return this.http
      .patch<{ message: string; count: number }>('/api/notifications/read-all', {})
      .pipe(
        tap(() => {
          // Update local state - mark all as read
          const allIds = this.notifications().map((n) => n._id);
          allIds.forEach((id) => {
            this.store.update(updateEntities(id, { read: true }));
          });

          // Notify MessageService about all message_received notifications that were marked read
          if (this._onMessageNotificationRead) {
            const messageNotifications = unreadNotifications.filter(
              (n) => n.type === 'message_received',
            );
            const processedNotebooks = new Set<string>();

            messageNotifications.forEach((n) => {
              const notebookId = n.data['notebookId'];
              const pageId = n.data['pageId'];
              if (notebookId && !processedNotebooks.has(notebookId)) {
                processedNotebooks.add(notebookId);
                this._onMessageNotificationRead!(notebookId, pageId);
              }
            });
          }

          // Sync badge - will include message unread count
          this.syncBadgeCount();
        }),
        map(() => void 0),
      );
  }

  /**
   * Mark all message_received notifications for a specific notebook as read
   * Called when user views a chat to sync notification state with viewed messages
   */
  markNotebookMessagesAsRead(notebookId: string): void {
    const unreadMessageNotifications = this.notifications().filter(
      (n) => !n.read && n.type === 'message_received' && n.data['notebookId'] === notebookId,
    );

    // Skip if no unread message notifications for this notebook
    if (unreadMessageNotifications.length === 0) {
      return;
    }

    // Mark all at once in store, then make API calls
    unreadMessageNotifications.forEach((n) => {
      this.store.update(updateEntities(n._id, { read: true }));
    });

    // Sync badge immediately
    this.syncBadgeCount();

    // Fire API calls in background
    unreadMessageNotifications.forEach((n) => {
      this.http.patch(`/api/notifications/${n._id}/read`, {}).subscribe();
    });
  }

  /**
   * Mark all message_received notifications for a specific page as read
   */
  markPageMessagesAsRead(pageId: string): void {
    const unreadMessageNotifications = this.notifications().filter(
      (n) => !n.read && n.type === 'message_received' && n.data['pageId'] === pageId,
    );

    if (unreadMessageNotifications.length === 0) {
      return;
    }

    // Mark all at once in store
    unreadMessageNotifications.forEach((n) => {
      this.store.update(updateEntities(n._id, { read: true }));
    });

    // Sync badge immediately
    this.syncBadgeCount();

    // Fire API calls in background
    unreadMessageNotifications.forEach((n) => {
      this.http.patch(`/api/notifications/${n._id}/read`, {}).subscribe();
    });
  }

  /**
   * Add a notification to the store (for real-time updates)
   */
  addNotification(notification: Notification): void {
    this.store.update(upsertEntities(notification));
    this.persistToIndexedDB([notification]);
    this.syncBadgeCount();
  }

  /**
   * Get list of registered devices
   */
  getDevices(): Observable<DeviceRegistration[]> {
    return this.http
      .get<{ devices: DeviceRegistration[] }>('/api/notifications/devices')
      .pipe(map((response) => response.devices));
  }

  // MARK: - Toast Management

  /**
   * Display an in-app toast notification
   */
  showToast(toast: Omit<ToastData, 'id'>): void {
    const id = nanoid();
    const newToast: ToastData = { ...toast, id };
    this.toasts.update((toasts) => [...toasts, newToast]);

    // Auto-remove after duration
    const duration = toast.duration || 5000;
    setTimeout(() => this.removeToast(id), duration);
  }

  /**
   * Remove a toast notification by ID
   */
  removeToast(id: string): void {
    this.toasts.update((toasts) => toasts.filter((t) => t.id !== id));
  }

  /**
   * Set the currently active notebook ID (for smart toast filtering)
   */
  setActiveNotebook(notebookId: string | null): void {
    this.activeNotebookId.set(notebookId);
  }

  // MARK: - Notification Handling

  /**
   * Handle foreground notifications with smart filtering
   * Only show toast if user is NOT currently viewing the tag
   */
  private handleForegroundNotification(notification: {
    notificationId: string;
    type: string;
    apiUrl: string;
    notebookId?: string;
    messageId?: string;
  }): void {
    // Check if user is viewing this notebook's messages
    const currentNotebookId = this.activeNotebookId();
    const notificationNotebookId = notification.notebookId;

    // Only show toast if NOT currently viewing this notebook
    if (!notificationNotebookId || notificationNotebookId !== currentNotebookId) {
      // Fetch full notification to get message content
      this.fetchNotification(notification.notificationId, notification.apiUrl).subscribe({
        next: (fullNotification) => {
          // Add to store for real-time updates
          this.addNotification(fullNotification);

          // Construct toast message from notification data
          let title = 'Notification';
          let message = 'You have a new notification';

          switch (fullNotification.type) {
            case 'message_received':
              // Show sender name (fallback to email) as title and message preview as body
              title =
                fullNotification.data['senderName'] ||
                fullNotification.data['senderEmail'] ||
                'New Message';
              message = fullNotification.data['messagePreview'] || 'New message';
              break;

            case 'share_received':
              title = 'New Share';
              message = fullNotification.data['sharedBy']
                ? `Shared by ${fullNotification.data['sharedBy']}`
                : 'Someone shared a note with you';
              break;

            case 'transcription_complete':
              title = 'Transcription Ready';
              message = 'Your audio transcription is complete';
              break;

            case 'reminder':
              title = 'Reminder';
              message = 'You have a reminder';
              break;

            case 'export_ready':
              title = 'Export Ready';
              message = 'Your export is ready for download';
              break;

            case 'processing_failed':
              title = 'Processing Failed';
              message = fullNotification.data['errorCode']
                ? `Error: ${fullNotification.data['errorCode']}`
                : 'An error occurred while processing';
              break;
          }

          this.showToast({
            title,
            message,
            type: 'info',
            duration: 5000,
          });
        },
        error: () => {
          // Silently fail - non-critical
        },
      });
    }
  }

  private handleNotificationTap(notification: {
    notificationId: string;
    type: string;
    apiUrl: string;
  }): void {
    // Fetch full notification content from the correct server and navigate
    this.fetchNotification(notification.notificationId, notification.apiUrl).subscribe({
      next: (fullNotification) => {
        this.navigateToNotification(fullNotification);
      },
      error: () => {
        // Silently fail - non-critical
      },
    });
  }

  private navigateToNotification(notification: Notification): void {
    // Handle navigation based on notification type
    switch (notification.type) {
      case 'share_received':
        if (notification.data['notebookId']) {
          this.router.navigate(['/', notification.data['notebookId']]);
        }
        break;

      case 'message_received':
        if (notification.data['notebookId']) {
          const notebookId = notification.data['notebookId'];
          const messageId = notification.data['messageId'];
          // Navigate to tag with optional message ID as query param for scrolling
          if (messageId) {
            this.router.navigate(['/', notebookId], { queryParams: { messageId } });
          } else {
            this.router.navigate(['/', notebookId]);
          }
        }
        break;

      case 'transcription_complete':
        if (notification.data['memoId']) {
          this.router.navigate(['/', notification.data['memoId']]);
        }
        break;

      case 'reminder':
        if (notification.data['memoId']) {
          this.router.navigate(['/', notification.data['memoId']]);
        }
        break;

      case 'export_ready':
      case 'processing_failed':
      default:
        // No navigation for these types
        break;
    }

    // Mark as read after navigation
    this.markAsRead(notification._id).subscribe();
  }
}

import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, take, Observable, map, tap } from 'rxjs';
import { nanoid } from 'nanoid';
import { NativeBridgeService } from './native-bridge.service';
import type { Notification, NotificationListResponse, DeviceRegistration } from '@maple/shared';
import type { ToastData } from '../components/atoms/toast/toast.component';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly router = inject(Router);

  // Signals for reactive state
  readonly notifications = signal<Notification[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
  readonly isRequestingPermission = signal(false);
  readonly permissionGranted = signal(false);
  readonly isRegistered = signal(false);
  readonly serverId = signal<string | null>(null);

  // Toast notifications
  readonly toasts = signal<ToastData[]>([]);

  // Current active tag (for smart toast filtering)
  readonly activeTagId = signal<string | null>(null);

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

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
          this.notifications.set(response.notifications);
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
    return this.http.patch<{ message: string }>(`/api/notifications/${id}/read`, {}).pipe(
      tap(() => {
        // Update local state
        const updated = this.notifications().map((n) => (n._id === id ? { ...n, read: true } : n));
        this.notifications.set(updated);
        // Sync badge count with native app
        this.syncBadgeCount();
      }),
      map(() => void 0),
    );
  }

  /**
   * Sync the badge count with the native app
   * This updates the app icon badge to reflect the current unread count
   */
  syncBadgeCount(): void {
    if (this.nativeBridge.isNativeApp()) {
      this.nativeBridge.setBadge(this.unreadCount());
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
    return this.http
      .patch<{ message: string; count: number }>('/api/notifications/read-all', {})
      .pipe(
        tap(() => {
          // Update local state
          const updated = this.notifications().map((n) => ({ ...n, read: true }));
          this.notifications.set(updated);
          // Clear the badge since all are read
          this.clearBadge();
        }),
        map(() => void 0),
      );
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
   * Set the currently active tag ID (for smart toast filtering)
   */
  setActiveTag(tagId: string | null): void {
    this.activeTagId.set(tagId);
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
    tagId?: string;
    messageId?: string;
  }): void {
    // Check if user is viewing this tag's messages
    const currentTagId = this.activeTagId();
    const notificationTagId = notification.tagId;

    // Only show toast if NOT currently viewing this tag
    if (!notificationTagId || notificationTagId !== currentTagId) {
      // Fetch full notification to get message content
      this.fetchNotification(notification.notificationId, notification.apiUrl).subscribe({
        next: (fullNotification) => {
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
        if (notification.data['tagId']) {
          this.router.navigate(['/', notification.data['tagId']]);
        }
        break;

      case 'message_received':
        if (notification.data['tagId']) {
          const tagId = notification.data['tagId'];
          const messageId = notification.data['messageId'];
          // Navigate to tag with optional message ID as query param for scrolling
          if (messageId) {
            this.router.navigate(['/', tagId], { queryParams: { messageId } });
          } else {
            this.router.navigate(['/', tagId]);
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

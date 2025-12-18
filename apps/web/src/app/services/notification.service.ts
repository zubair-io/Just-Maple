import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, take } from 'rxjs';
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
        console.log('[NotificationService] Notification tapped:', notification);
        this.handleNotificationTap(notification);
      });

      // Listen for foreground notifications
      this.nativeBridge.onForegroundNotification().subscribe((notification) => {
        console.log('[NotificationService] Foreground notification:', notification);
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
      console.warn('[NotificationService] Push notifications only available in native app');
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
    } catch (error) {
      console.error('[NotificationService] Failed to request push permission:', error);
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
      const response = await firstValueFrom(this.nativeBridge.onPushStatus().pipe(take(1)));

      // If local says registered, just trust it (no longer need server verification with serverUrl approach)
      this.isRegistered.set(response.isRegistered);
      this.serverId.set(response.serverId || null);
    } catch (error) {
      console.error('[NotificationService] Failed to check push status:', error);
    }
  }

  /**
   * Unregister from push notifications
   */
  async unregisterPushNotifications(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      console.warn('[NotificationService] Push notifications only available in native app');
      return;
    }

    const currentServerId = this.serverId();
    if (!currentServerId) {
      console.log('[NotificationService] No server ID found, nothing to unregister');
      return;
    }

    try {
      // Tell native app to unregister (it will call the API and clear local state)
      this.nativeBridge.unregisterPushNotifications();

      // Wait for response
      const response = await firstValueFrom(this.nativeBridge.onPushUnregistered().pipe(take(1)));

      if (response.success) {
        // Clear web app state
        this.isRegistered.set(false);
        this.serverId.set(null);
        console.log('[NotificationService] Successfully unregistered from push notifications');
      } else {
        throw new Error(response.error || 'Failed to unregister');
      }
    } catch (error) {
      console.error('[NotificationService] Failed to unregister from push notifications:', error);
      throw error;
    }
  }

  // MARK: - Notification History

  /**
   * Fetch notification history from server
   */
  async fetchNotifications(limit = 50, skip = 0): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<NotificationListResponse>('/api/notifications', {
          params: { limit: limit.toString(), skip: skip.toString() },
        }),
      );

      this.notifications.set(response.notifications);
    } catch (error) {
      console.error('[NotificationService] Failed to fetch notifications:', error);
      throw error;
    }
  }

  /**
   * Fetch a single notification by ID
   */
  async fetchNotification(id: string, apiUrl?: string): Promise<Notification> {
    console.log(`[NotificationService] 📡 Fetching notification ID: ${id}`);
    console.log(`[NotificationService] 📡 API URL: ${apiUrl || 'default'}`);

    try {
      const url = apiUrl ? `${apiUrl}/api/notifications/${id}` : `/api/notifications/${id}`;
      console.log(`[NotificationService] 📡 Full URL: ${url}`);
      console.log(`[NotificationService] 📡 Making HTTP GET request...`);

      const response = await firstValueFrom(this.http.get<{ notification: Notification }>(url));

      console.log(
        `[NotificationService] ✅ Successfully fetched notification:`,
        response.notification,
      );
      return response.notification;
    } catch (error) {
      console.error('[NotificationService] ❌ Failed to fetch notification:', error);
      console.error('[NotificationService] ❌ Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch<{ message: string }>(`/api/notifications/${id}/read`, {}),
      );

      // Update local state
      const updated = this.notifications().map((n) => (n._id === id ? { ...n, read: true } : n));
      this.notifications.set(updated);
    } catch (error) {
      console.error('[NotificationService] Failed to mark notification as read:', error);
      throw error;
    }
  }

  /**
   * Get list of registered devices
   */
  async getDevices(): Promise<DeviceRegistration[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ devices: DeviceRegistration[] }>('/api/notifications/devices'),
      );

      return response.devices;
    } catch (error) {
      console.error('[NotificationService] Failed to fetch devices:', error);
      throw error;
    }
  }

  // MARK: - Toast Management

  /**
   * Display an in-app toast notification
   */
  showToast(toast: Omit<ToastData, 'id'>): void {
    const id = crypto.randomUUID();
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
    console.log('[NotificationService] 🔔 Processing foreground notification');
    console.log('[NotificationService] 🔔 Current active tag:', this.activeTagId());
    console.log('[NotificationService] 🔔 Notification tag:', notification.tagId);

    // Check if user is viewing this tag's messages
    const currentTagId = this.activeTagId();
    const notificationTagId = notification.tagId;

    // Only show toast if NOT currently viewing this tag
    if (!notificationTagId || notificationTagId !== currentTagId) {
      console.log('[NotificationService] 🔔 Showing toast (user not in this tag)');

      // Fetch full notification to get message content
      this.fetchNotification(notification.notificationId, notification.apiUrl)
        .then((fullNotification) => {
          const title = fullNotification.title || 'New Message';
          const message = fullNotification.body || 'You have a new message';

          this.showToast({
            title,
            message,
            type: 'info',
            duration: 5000,
          });
        })
        .catch((error) => {
          console.error('[NotificationService] ❌ Failed to fetch foreground notification:', error);
        });
    } else {
      console.log(
        '[NotificationService] 🔔 Suppressing toast (user is in this tag - message shown via SignalR)',
      );
    }
  }

  private handleNotificationTap(notification: {
    notificationId: string;
    type: string;
    apiUrl: string;
  }): void {
    console.log('[NotificationService] 👆 Notification tap received from native app!');
    console.log('[NotificationService] 👆 Notification ID:', notification.notificationId);
    console.log('[NotificationService] 👆 Type:', notification.type);
    console.log('[NotificationService] 👆 API URL:', notification.apiUrl);

    // Fetch full notification content from the correct server and navigate
    console.log('[NotificationService] 👆 Fetching full notification data...');
    this.fetchNotification(notification.notificationId, notification.apiUrl)
      .then((fullNotification) => {
        console.log('[NotificationService] 👆 Got full notification, navigating...');
        this.navigateToNotification(fullNotification);
      })
      .catch((error) => {
        console.error('[NotificationService] ❌ Failed to fetch tapped notification:', error);
      });
  }

  private navigateToNotification(notification: Notification): void {
    console.log(
      '[NotificationService] 🧭 Navigating based on notification type:',
      notification.type,
    );
    console.log('[NotificationService] 🧭 Notification data:', notification.data);

    // Handle navigation based on notification type
    switch (notification.type) {
      case 'share_received':
        if (notification.data['tagId']) {
          const tagId = notification.data['tagId'];
          console.log(`[NotificationService] 🧭 Navigating to shared tag: ${tagId}`);
          window.location.hash = `/${tagId}`;
        } else {
          console.warn('[NotificationService] ⚠️ share_received notification missing tagId');
        }
        break;

      case 'message_received':
        if (notification.data['tagId']) {
          const tagId = notification.data['tagId'];
          console.log(`[NotificationService] 🧭 Navigating to tag with new message: ${tagId}`);
          window.location.hash = `/${tagId}`;
        } else {
          console.warn('[NotificationService] ⚠️ message_received notification missing tagId');
        }
        break;

      case 'transcription_complete':
        if (notification.data['memoId']) {
          const memoId = notification.data['memoId'];
          console.log(`[NotificationService] 🧭 Navigating to memo: ${memoId}`);
          window.location.hash = `/${memoId}`;
        } else {
          console.warn(
            '[NotificationService] ⚠️ transcription_complete notification missing memoId',
          );
        }
        break;

      case 'reminder':
        if (notification.data['memoId']) {
          const memoId = notification.data['memoId'];
          console.log(`[NotificationService] 🧭 Navigating to memo (reminder): ${memoId}`);
          window.location.hash = `/${memoId}`;
        } else {
          console.warn('[NotificationService] ⚠️ reminder notification missing memoId');
        }
        break;

      case 'export_ready':
        console.log('[NotificationService] 📦 Export ready:', notification.data['exportId']);
        break;

      case 'processing_failed':
        console.error(
          '[NotificationService] ❌ Processing failed:',
          notification.data['errorCode'],
        );
        break;

      default:
        console.warn('[NotificationService] ⚠️ Unknown notification type:', notification.type);
    }

    // Mark as read after navigation
    console.log(`[NotificationService] 📖 Marking notification ${notification._id} as read...`);
    this.markAsRead(notification._id)
      .then(() => {
        console.log(`[NotificationService] ✅ Marked notification ${notification._id} as read`);
      })
      .catch((error) => {
        console.error('[NotificationService] ❌ Failed to mark notification as read:', error);
      });
  }
}

import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, take } from 'rxjs';
import { NativeBridgeService } from './native-bridge.service';
import type { Notification, NotificationListResponse, DeviceRegistration } from '@maple/shared';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly nativeBridge = inject(NativeBridgeService);

  // Signals for reactive state
  readonly notifications = signal<Notification[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
  readonly isRequestingPermission = signal(false);
  readonly permissionGranted = signal(false);
  readonly isRegistered = signal(false);
  readonly serverKey = signal<string | null>(null);

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
        this.serverKey.set(response.serverKey || null);
      });

      // Listen for notification taps
      this.nativeBridge.onNotificationTapped().subscribe((notification) => {
        console.log('[NotificationService] Notification tapped:', notification);
        // TODO: Handle navigation based on notification type
        this.handleNotificationTap(notification);
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
   */
  async checkPushStatus(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return;
    }

    this.nativeBridge.getPushStatus();

    try {
      const response = await firstValueFrom(this.nativeBridge.onPushStatus().pipe(take(1)));

      this.isRegistered.set(response.isRegistered);
      this.serverKey.set(response.serverKey || null);
    } catch (error) {
      console.error('[NotificationService] Failed to check push status:', error);
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
  async fetchNotification(id: string): Promise<Notification> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ notification: Notification }>(`/api/notifications/${id}`),
      );

      return response.notification;
    } catch (error) {
      console.error('[NotificationService] Failed to fetch notification:', error);
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

  // MARK: - Notification Handling

  private handleNotificationTap(notification: { notificationId: string; type: string }): void {
    // Fetch full notification content and navigate
    this.fetchNotification(notification.notificationId)
      .then((fullNotification) => {
        this.navigateToNotification(fullNotification);
      })
      .catch((error) => {
        console.error('[NotificationService] Failed to fetch tapped notification:', error);
      });
  }

  private navigateToNotification(notification: Notification): void {
    // Handle navigation based on notification type
    switch (notification.type) {
      case 'share_received':
        if (notification.data['tagId']) {
          // Navigate to shared tag
          window.location.hash = `/${notification.data['tagId']}`;
        }
        break;

      case 'transcription_complete':
        if (notification.data['memoId']) {
          // Navigate to memo
          window.location.hash = `/${notification.data['memoId']}`;
        }
        break;

      case 'reminder':
        if (notification.data['memoId']) {
          // Navigate to memo
          window.location.hash = `/${notification.data['memoId']}`;
        }
        break;

      case 'export_ready':
        // Could open export download page
        console.log('[NotificationService] Export ready:', notification.data['exportId']);
        break;

      case 'processing_failed':
        // Show error details
        console.error('[NotificationService] Processing failed:', notification.data['errorCode']);
        break;

      default:
        console.log('[NotificationService] Unknown notification type:', notification.type);
    }

    // Mark as read after navigation
    this.markAsRead(notification._id).catch((error) => {
      console.error('[NotificationService] Failed to mark notification as read:', error);
    });
  }
}

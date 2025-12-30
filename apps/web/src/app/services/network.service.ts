import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RealtimeService } from './realtime.service';
import { NotificationService } from './notification.service';

@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly realtime = inject(RealtimeService);
  private readonly notifications = inject(NotificationService);

  private readonly _isOnline = signal(true);
  readonly isOnline = this._isOnline.asReadonly();
  readonly isOffline = computed(() => !this._isOnline());

  private readonly _lastOnlineAt = signal<Date>(new Date());
  readonly lastOnlineAt = this._lastOnlineAt.asReadonly();

  // Track last time we showed the offline toast (10-minute buffer)
  private lastOfflineToastTime: number = 0;
  private readonly OFFLINE_TOAST_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupBrowserListeners();
      this.setupRealtimeMonitoring();
      this.setupOfflineToastNotification();
    }
  }

  private setupBrowserListeners(): void {
    this._isOnline.set(navigator.onLine);

    window.addEventListener('online', () => {
      this._isOnline.set(true);
      this._lastOnlineAt.set(new Date());
    });

    window.addEventListener('offline', () => {
      this._isOnline.set(false);
    });
  }

  private setupRealtimeMonitoring(): void {
    effect(() => {
      const wsStatus = this.realtime.status();
      if (wsStatus === 'connected') {
        this._isOnline.set(true);
        this._lastOnlineAt.set(new Date());
      }
    });
  }

  private setupOfflineToastNotification(): void {
    effect(() => {
      const isOnline = this._isOnline();

      // Show toast when going offline (with time buffer)
      if (!isOnline) {
        const now = Date.now();
        const timeSinceLastToast = now - this.lastOfflineToastTime;

        // Only show toast if it's been more than 10 minutes since the last one
        if (timeSinceLastToast >= this.OFFLINE_TOAST_BUFFER_MS) {
          this.notifications.showToast({
            title: 'You are offline',
            message: 'Showing cached data. Changes will sync when you reconnect.',
            type: 'warning',
            duration: 5000,
          });

          this.lastOfflineToastTime = now;
        }
      }
    });
  }
}

import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { NetworkService } from './network.service';

/**
 * Connectivity Service
 * Extends network online/offline detection with server health checks
 * Used for offline-first sync decisions
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly network = inject(NetworkService);

  // Server reachability (separate from browser online status)
  private readonly _isServerReachable = signal(true);
  readonly isServerReachable = this._isServerReachable.asReadonly();

  // Combined: browser online AND server reachable
  readonly canSync = computed(() => this.network.isOnline() && this._isServerReachable());

  // Expose network online status
  readonly isOnline = this.network.isOnline;
  readonly isOffline = this.network.isOffline;

  // Health check interval (30 seconds)
  private readonly HEALTH_CHECK_INTERVAL = 30000;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Track consecutive failures for backoff
  private consecutiveFailures = 0;
  private readonly MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes max

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.startHealthChecks();
      this.setupNetworkListeners();
    }
  }

  private setupNetworkListeners(): void {
    // When browser comes online, immediately check server
    effect(() => {
      if (this.network.isOnline()) {
        this.checkServerHealth();
      } else {
        this._isServerReachable.set(false);
      }
    });
  }

  private startHealthChecks(): void {
    // Initial check
    this.checkServerHealth();

    // Periodic checks
    this.healthCheckTimer = setInterval(() => {
      if (this.network.isOnline()) {
        this.checkServerHealth();
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check if server is reachable
   */
  async checkServerHealth(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (!this.network.isOnline()) {
      this._isServerReachable.set(false);
      return false;
    }

    try {
      await firstValueFrom(
        this.http
          .get('/api/health', {
            headers: { 'Cache-Control': 'no-store' },
          })
          .pipe(timeout(5000)),
      );

      this._isServerReachable.set(true);
      this.consecutiveFailures = 0;
      return true;
    } catch {
      this.handleHealthCheckFailure();
      return false;
    }
  }

  private handleHealthCheckFailure(): void {
    this._isServerReachable.set(false);
    this.consecutiveFailures++;

    // Implement exponential backoff for health checks
    if (this.consecutiveFailures > 3 && this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      const backoff = Math.min(
        this.HEALTH_CHECK_INTERVAL * Math.pow(2, this.consecutiveFailures - 3),
        this.MAX_BACKOFF,
      );
      this.healthCheckTimer = setInterval(() => {
        if (this.network.isOnline()) {
          this.checkServerHealth();
        }
      }, backoff);
    }
  }

  /**
   * Manually trigger sync attempt
   * Useful after user action that might restore connectivity
   */
  async triggerSync(): Promise<boolean> {
    const canSync = await this.checkServerHealth();
    if (canSync) {
      // Reset health check interval to normal
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
      }
      this.startHealthChecks();
    }
    return canSync;
  }

  /**
   * Wait for connectivity to be available
   * Returns a promise that resolves when sync is possible
   */
  waitForSync(timeout = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.canSync()) {
        resolve(true);
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.canSync()) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(true);
        }
      }, 1000);

      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, timeout);
    });
  }

  ngOnDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }
}

import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { VisibilityService } from './visibility.service';

@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly swUpdate = inject(SwUpdate);
  private readonly visibilityService = inject(VisibilityService);

  private lastCheckTime = 0;
  private readonly CHECK_INTERVAL_MS = 60000; // Check at most once per minute

  /** Signal indicating a new SW version is ready and waiting */
  readonly updateAvailable = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    // Listen for version ready events
    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        this.updateAvailable.set(true);
        this.showUpdateNotification();
      });

    // Check for updates on focus/visibility (browser only)
    if (isPlatformBrowser(this.platformId)) {
      this.visibilityService.becameVisible$.subscribe(() => {
        this.checkForUpdate();
      });

      window.addEventListener('focus', () => {
        this.checkForUpdate();
      });
    }
  }

  /**
   * Check for SW updates (rate-limited)
   */
  private async checkForUpdate(): Promise<void> {
    const now = Date.now();

    // Rate limit checks
    if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
      return;
    }

    this.lastCheckTime = now;

    try {
      const updateAvailable = await this.swUpdate.checkForUpdate();
      if (updateAvailable) {
        console.log('[SW] Update available');
      }
    } catch (err) {
      console.debug('[SW] Update check failed:', err);
    }
  }

  private showUpdateNotification(): void {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'sw-update-toast';
    toast.innerHTML = `
            <span>A new version is available</span>
            <button class="sw-update-btn">Update</button>
        `;

    // Add styles
    toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--color-surface, #fff);
            color: var(--color-text-main, #1f2937);
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 10000;
            font-size: 14px;
            border: 1px solid var(--color-border, #e5e7eb);
        `;

    const button = toast.querySelector('.sw-update-btn') as HTMLButtonElement;
    button.style.cssText = `
            background: var(--color-primary, #D94E3B);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
        `;

    button.addEventListener('click', () => {
      document.location.reload();
    });

    document.body.appendChild(toast);

    // Auto-dismiss after 2 minutes
    setTimeout(() => {
      toast.remove();
    }, 120000);
  }
}

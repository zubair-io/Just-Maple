import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { VisibilityService } from './visibility.service';

interface VersionInfo {
  version: string;
  buildTime?: string;
}

/**
 * App Version Service
 * Checks for new app versions on window focus/visibility change
 * and prompts user to reload if a new version is available
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly visibilityService = inject(VisibilityService);

  private currentVersion: string | null = null;
  private lastCheckTime = 0;
  private readonly CHECK_INTERVAL_MS = 60000; // Check at most once per minute
  private updateAvailable = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initialize();
    }
  }

  private initialize(): void {
    // Fetch initial version
    this.fetchVersion().then((version) => {
      this.currentVersion = version;
      console.log(`[AppVersion] Current version: ${version}`);
    });

    // Check for updates when window becomes visible
    this.visibilityService.becameVisible$.subscribe(() => {
      this.checkForUpdate();
    });

    // Also check on focus (in addition to visibility)
    window.addEventListener('focus', () => {
      this.checkForUpdate();
    });
  }

  /**
   * Check for app updates
   * Only checks if enough time has passed since last check
   */
  private async checkForUpdate(): Promise<void> {
    const now = Date.now();

    // Rate limit checks
    if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
      return;
    }

    // Don't check if we already know an update is available
    if (this.updateAvailable) {
      return;
    }

    this.lastCheckTime = now;

    try {
      const newVersion = await this.fetchVersion();

      if (this.currentVersion && newVersion && newVersion !== this.currentVersion) {
        console.log(
          `[AppVersion] New version available: ${newVersion} (current: ${this.currentVersion})`,
        );
        this.updateAvailable = true;
        this.showUpdateNotification();
      }
    } catch (err) {
      // Silently fail - network errors are expected
      console.debug('[AppVersion] Version check failed:', err);
    }
  }

  /**
   * Fetch current version from server
   */
  private async fetchVersion(): Promise<string | null> {
    try {
      // Try to fetch version from health endpoint
      const response = await firstValueFrom(
        this.http.get<{ version?: string; buildTime?: string }>('/api/health'),
      );

      return response.version || null;
    } catch {
      // Fallback: try to fetch version.json from assets
      try {
        const response = await firstValueFrom(
          this.http.get<VersionInfo>('/version.json', {
            headers: { 'Cache-Control': 'no-cache' },
          }),
        );
        return response.version || null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Show update notification to user
   */
  private showUpdateNotification(): void {
    // Create notification toast
    const toast = document.createElement('div');
    toast.className = 'app-update-toast';
    toast.innerHTML = `
            <div class="app-update-toast-content">
                <span class="app-update-toast-icon">🚀</span>
                <span class="app-update-toast-message">A new version is available</span>
                <button class="app-update-toast-button" id="app-update-reload">Update</button>
                <button class="app-update-toast-dismiss" id="app-update-dismiss">×</button>
            </div>
        `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
            .app-update-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 10000;
                animation: slideInUp 0.3s ease-out;
            }
            .app-update-toast-content {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: var(--color-surface, #1a1a1a);
                border: 1px solid var(--color-border, #333);
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                color: var(--color-text-main, #fff);
                font-size: 14px;
            }
            .app-update-toast-icon {
                font-size: 20px;
            }
            .app-update-toast-message {
                flex: 1;
            }
            .app-update-toast-button {
                padding: 6px 16px;
                background: var(--color-primary, #D94E3B);
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.2s;
            }
            .app-update-toast-button:hover {
                background: var(--color-primary-hover, #c44535);
            }
            .app-update-toast-dismiss {
                padding: 4px 8px;
                background: transparent;
                color: var(--color-text-muted, #888);
                border: none;
                font-size: 18px;
                cursor: pointer;
                transition: color 0.2s;
            }
            .app-update-toast-dismiss:hover {
                color: var(--color-text-main, #fff);
            }
            @keyframes slideInUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;

    document.head.appendChild(style);
    document.body.appendChild(toast);

    // Handle update button
    document.getElementById('app-update-reload')?.addEventListener('click', () => {
      window.location.reload();
    });

    // Handle dismiss button
    document.getElementById('app-update-dismiss')?.addEventListener('click', () => {
      toast.remove();
      // Don't show again for this session
    });
  }

  /**
   * Get current version
   */
  getVersion(): string | null {
    return this.currentVersion;
  }

  /**
   * Check if update is available
   */
  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }
}

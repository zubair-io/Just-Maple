import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class LogRocketService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private isInitialized = false;

  async init(): Promise<void> {
    // Only initialize in browser and production
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!environment.production || !environment.logRocketAppId) {
      console.log('[LogRocket] Skipping initialization (not production or no app ID)');
      return;
    }

    try {
      // Dynamically import LogRocket only in production
      const LogRocket = (await import('logrocket')).default;

      LogRocket.init(environment.logRocketAppId, {
        // Optional configurations
        console: {
          shouldAggregateConsoleErrors: true,
        },
        network: {
          requestSanitizer: (request) => {
            // Sanitize sensitive headers
            if (request.headers && request.headers['Authorization']) {
              request.headers['Authorization'] = '[REDACTED]';
            }
            return request;
          },
          responseSanitizer: (response) => {
            // Sanitize sensitive response data if needed
            return response;
          },
        },
      });

      this.isInitialized = true;
      console.log('[LogRocket] Initialized successfully');

      // Identify user if already logged in
      const user = this.authService.user();
      if (user) {
        this.identifyUser(user._id, user.email, user.displayName);
      }

      // Listen for future auth changes
      this.authService.initReady$.subscribe(() => {
        const currentUser = this.authService.user();
        if (currentUser) {
          this.identifyUser(currentUser._id, currentUser.email, currentUser.displayName);
        }
      });
    } catch (error) {
      console.error('[LogRocket] Failed to initialize:', error);
    }
  }

  private async identifyUser(userId: string, email?: string, displayName?: string): Promise<void> {
    if (!this.isInitialized) return;

    try {
      const LogRocket = (await import('logrocket')).default;
      LogRocket.identify(userId, {
        email: email || 'unknown',
        name: displayName || email?.split('@')[0] || 'Unknown User',
      });
      console.log('[LogRocket] User identified:', userId);
    } catch (error) {
      console.error('[LogRocket] Failed to identify user:', error);
    }
  }

  async captureException(
    error: Error,
    extra?: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!this.isInitialized) return;

    try {
      const LogRocket = (await import('logrocket')).default;
      LogRocket.captureException(error, { extra });
    } catch (e) {
      console.error('[LogRocket] Failed to capture exception:', e);
    }
  }

  async track(
    eventName: string,
    properties?: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!this.isInitialized) return;

    try {
      const LogRocket = (await import('logrocket')).default;
      LogRocket.track(eventName, properties);
    } catch (error) {
      console.error('[LogRocket] Failed to track event:', error);
    }
  }

  async getSessionURL(): Promise<string | null> {
    if (!this.isInitialized) return null;

    try {
      const LogRocket = (await import('logrocket')).default;
      return LogRocket.sessionURL || null;
    } catch (error) {
      console.error('[LogRocket] Failed to get session URL:', error);
      return null;
    }
  }
}

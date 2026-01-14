import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  isDevMode,
  APP_INITIALIZER,
} from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { SwUpdateService } from './services/sw-update.service';
import { LogRocketService } from './services/logrocket.service';

/**
 * Detect if running inside iOS WKWebView (native app).
 * Service workers are not supported in WKWebView, only in Safari and home screen PWAs.
 */
function isNativeApp(): boolean {
  return !!(
    (window as any).webkit?.messageHandlers?.nativeBridge || (window as any).__nativeBridge__
  );
}

/**
 * Service workers should only be enabled when:
 * 1. Not in development mode
 * 2. Not running inside a native app (WKWebView doesn't support service workers)
 */
function shouldEnableServiceWorker(): boolean {
  return !isDevMode() && !isNativeApp();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: shouldEnableServiceWorker(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Initialize SW update service
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {},
      deps: [SwUpdateService],
      multi: true,
    },
    // Initialize LogRocket (production only)
    {
      provide: APP_INITIALIZER,
      useFactory: (logRocketService: LogRocketService) => () => logRocketService.init(),
      deps: [LogRocketService],
      multi: true,
    },
  ],
};

import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  isDevMode,
  APP_INITIALIZER,
} from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { SwUpdateService } from './services/sw-update.service';
import { LogRocketService } from './services/logrocket.service';
import { whiteboardProviders } from './whiteboard-providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
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
    // Whiteboard package DI tokens
    ...whiteboardProviders,
  ],
};

import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { SwUpdateService } from './app/services/sw-update.service';
import { NativeBridgeService } from './app/services/native-bridge.service';

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    // Initialize service worker updates
    appRef.injector.get(SwUpdateService);

    // Initialize native bridge and deep link handling
    const nativeBridge = appRef.injector.get(NativeBridgeService);
    const router = appRef.injector.get(Router);

    // Handle deep links from native app
    nativeBridge.onDeepLink().subscribe((deepLink) => {
      console.log('[Main] Deep link received:', deepLink.url);

      try {
        const url = new URL(deepLink.url);

        // Extract path and navigate
        const path = url.pathname + url.search + url.hash;
        console.log('[Main] Navigating to:', path);

        router.navigateByUrl(path);
      } catch (err) {
        console.error('[Main] Failed to parse deep link:', err);
      }
    });

    if (nativeBridge.isNativeApp()) {
      console.log('[Main] Running in native app');
    }
  })
  .catch((err) => console.error(err));

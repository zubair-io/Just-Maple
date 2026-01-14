import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { take } from 'rxjs';
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

    // Helper to navigate to a deep link URL
    const navigateToDeepLink = (deepLinkUrl: string) => {
      try {
        const url = new URL(deepLinkUrl);
        const path = url.pathname + url.search + url.hash;
        console.log('[Main] Navigating to deep link path:', path);
        router.navigateByUrl(path);
      } catch (err) {
        console.error('[Main] Failed to parse deep link:', err);
      }
    };

    // Handle deep links from native app (for when app is already running)
    nativeBridge.onDeepLink().subscribe((deepLink) => {
      console.log('[Main] Deep link received:', deepLink.url);
      navigateToDeepLink(deepLink.url);
    });

    if (nativeBridge.isNativeApp()) {
      console.log('[Main] Running in native app');

      // Check if there's an initial deep link from app launch
      // This handles the case where the app was opened via a universal link (cold start)
      const initialState = nativeBridge.getInitialState();
      if (initialState?.initialDeepLink) {
        console.log('[Main] Initial deep link found:', initialState.initialDeepLink);
        navigateToDeepLink(initialState.initialDeepLink);
      } else {
        // Subscribe to initialize message in case it arrives after bootstrap
        nativeBridge
          .onInitialize()
          .pipe(take(1))
          .subscribe((state) => {
            if (state.initialDeepLink) {
              console.log('[Main] Initial deep link from initialize:', state.initialDeepLink);
              navigateToDeepLink(state.initialDeepLink);
            }
          });
      }
    }
  })
  .catch((err) => console.error(err));

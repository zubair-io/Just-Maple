import './app/utils/readable-stream-async-iterator-polyfill';
import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { NativeBridgeService } from './app/services/native-bridge.service';

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    const nativeBridge = appRef.injector.get(NativeBridgeService);
    const router = appRef.injector.get(Router);

    const navigateToDeepLink = (deepLinkUrl: string) => {
      try {
        const url = new URL(deepLinkUrl);
        const path = url.pathname + url.search + url.hash;
        router.navigateByUrl(path);
      } catch (err) {
        console.error('[Main] Failed to parse deep link:', err);
      }
    };

    nativeBridge.onDeepLink().subscribe((deepLink) => {
      navigateToDeepLink(deepLink.url);
    });

    if (nativeBridge.isNativeApp()) {
      const initialState = nativeBridge.getInitialState();
      if (initialState?.initialDeepLink) {
        navigateToDeepLink(initialState.initialDeepLink);
      } else {
        nativeBridge
          .onInitialize()
          .pipe(take(1))
          .subscribe((state) => {
            if (state.initialDeepLink) {
              navigateToDeepLink(state.initialDeepLink);
            }
          });
      }
    }
  })
  .catch((err) => console.error(err));

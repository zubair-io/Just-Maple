import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn } from '@angular/router';
import { SwUpdateService } from '../services/sw-update.service';

/**
 * Guard that forces a full page navigation when a Service Worker update is available.
 * This ensures the new SW takes control immediately instead of waiting for the next full reload.
 */
export const swUpdateGuard: CanActivateFn & CanActivateChildFn = (_route, state) => {
  const swUpdate = inject(SwUpdateService);

  if (swUpdate.updateAvailable()) {
    // Force full page navigation to activate new SW
    window.location.href = state.url;
    return false;
  }

  return true;
};

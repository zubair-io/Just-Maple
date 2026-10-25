import { inject } from '@angular/core';
import type { CanMatchFn, Route, UrlSegment } from '@angular/router';
import type { MacDataSource } from '@maple/shared';
import { MacDataService } from '../services/mac-data.service';

/**
 * Matches `mac/:id` routes whose local page shows `expectedSource`.
 * Mac data pages exist only in the Mac app's local registry, never in the page store.
 */
function createMacDataPageGuard(expectedSource: MacDataSource): CanMatchFn {
  return async (_route: Route, segments: UrlSegment[]) => {
    const macData = inject(MacDataService);
    const id = segments[1]?.path;
    if (segments[0]?.path !== 'mac' || !id || !macData.isAvailable()) return false;
    try {
      return (await macData.getPage(id))?.source === expectedSource;
    } catch {
      return false;
    }
  };
}

export const IMessagePageGuard = createMacDataPageGuard('imessage');
export const MailPageGuard = createMacDataPageGuard('mail');
export const CalendarPageGuard = createMacDataPageGuard('calendar');

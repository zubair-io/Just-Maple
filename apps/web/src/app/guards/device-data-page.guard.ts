import { inject } from '@angular/core';
import type { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map, take, tap, timeout } from 'rxjs/operators';
import type { MacDataSource } from '@maple/shared';
import { PageService } from '../services/page.service';
import { isLocalPage } from '../providers/data-provider.interface';

/**
 * Matches `/:notebookId/:id` when the page is a device data page showing `expectedSource`.
 * Works like the other page type guards: waits briefly for the page to reach the store.
 */
function createDeviceDataPageGuard(expectedSource: MacDataSource): CanMatchFn {
  return (_route: Route, segments: UrlSegment[]) => {
    const pageService = inject(PageService);
    const id = segments[0]?.path;
    if (!id || id === 'new' || isLocalPage(id)) return false;

    return pageService.select(id).pipe(
      timeout(5000),
      take(1),
      map((page) => page.type === 'devicedata' && page.deviceSource === expectedSource),
      tap((matches) => {
        if (matches) pageService.setActivePageId(id);
      }),
      catchError(() => of(false)),
    );
  };
}

export const IMessagePageGuard = createDeviceDataPageGuard('imessage');
export const MailPageGuard = createDeviceDataPageGuard('mail');
export const CalendarPageGuard = createDeviceDataPageGuard('calendar');
export const ContactsPageGuard = createDeviceDataPageGuard('contacts');
export const PlacesPageGuard = createDeviceDataPageGuard('location');
export const HealthPageGuard = createDeviceDataPageGuard('health');
export const HomePageGuard = createDeviceDataPageGuard('home');

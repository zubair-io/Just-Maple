import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, fromEvent, of } from 'rxjs';
import { map, startWith, filter, shareReplay } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class VisibilityService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Emits true when visible, false when hidden */
  readonly visible$: Observable<boolean> = isPlatformBrowser(this.platformId)
    ? fromEvent(document, 'visibilitychange').pipe(
        map(() => document.visibilityState === 'visible'),
        startWith(document.visibilityState === 'visible'),
        shareReplay(1),
      )
    : of(true);

  /** Emits only when document becomes visible (filters out hidden events) */
  readonly becameVisible$ = this.visible$.pipe(filter((visible) => visible));
}

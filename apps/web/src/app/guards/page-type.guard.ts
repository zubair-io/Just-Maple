import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { map, take, timeout, catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { PageService } from '../services/page.service';
import type { PageType } from '@maple/shared';

/**
 * Creates a guard that matches routes based on page type.
 * Returns an Observable that checks if the page exists in the store with a timeout.
 */
function createPageTypeGuard(expectedType: PageType): CanMatchFn {
  return (route: Route, segments: UrlSegment[]) => {
    const pageService = inject(PageService);

    // documentId is the second segment (/:notebookId/:documentId)
    const documentId = segments[0]?.path;
    if (!documentId) return false;

    // Allow 'new' route ONLY for write-type pages
    if (documentId === 'new') {
      return false;
    }

    // If not in store, wait briefly for it to load (max 5 seconds)
    return pageService.select(documentId).pipe(
      timeout(5000),
      take(1),
      map((page) => {
        if (!page) return false;
        return (page.type || 'write') === expectedType;
      }),
      tap((matches) => {
        if (matches) {
          pageService.setActivePageId(documentId);
        }
      }),
      catchError(() => of(false)), // If timeout or error, return false
    );
  };
}

/** Guard that matches write-type pages */
export const WritePageGuard = createPageTypeGuard('write');

/** Guard that matches lego-type pages */
export const LegoPageGuard = createPageTypeGuard('lego');

/** Guard that matches draw-type pages */
export const DrawPageGuard = createPageTypeGuard('draw');

/** Guard that matches kanban-type pages */
export const KanbanPageGuard = createPageTypeGuard('kanban');

/** Guard that matches notebook-type pages (rich text notebook editor) */
export const NotebookPageGuard = createPageTypeGuard('notebook');

import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { map, take, timeout, catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { PageService } from '../services/page.service';
import { isLocalPage } from '../providers/data-provider.interface';
import type { PageType } from '@maple/shared';

/**
 * Creates a guard that matches routes based on page type.
 * Returns an Observable that checks if the page exists in the store with a timeout.
 */
function createPageTypeGuard(expectedType: PageType): CanMatchFn {
  return (route: Route, segments: UrlSegment[]) => {
    const pageService = inject(PageService);

    // id is the second segment (/:notebookId/:id)
    const id = segments[0]?.path;
    if (!id) return false;

    // Allow 'new' route to pass to NewNoteComponent
    if (id === 'new') {
      return false;
    }

    // Local pages are always memos — match immediately without store lookup
    if (isLocalPage(id)) {
      const matches = expectedType === 'memo';
      if (matches) {
        pageService.setActivePageId(id);
      }
      return matches;
    }

    // If not in store, wait briefly for it to load (max 5 seconds)
    return pageService.select(id).pipe(
      timeout(5000),
      take(1),
      map((page) => {
        if (!page) return false;
        return page.type === expectedType;
      }),
      tap((matches) => {
        if (matches) {
          pageService.setActivePageId(id);
        }
      }),
      catchError(() => of(false)), // If timeout or error, return false
    );
  };
}

/** Guard that matches collectable-type pages */
export const CollectablePageGuard = createPageTypeGuard('collectable');

/** Guard that matches whiteboard-type pages */
export const WhiteboardPageGuard = createPageTypeGuard('whiteboard');

/** Guard that matches kanban-type pages */
export const KanbanPageGuard = createPageTypeGuard('kanban');

/** Guard that matches memo-type pages (rich text notebook editor) */
export const MemoPageGuard = createPageTypeGuard('memo');

/** Guard that matches message-type pages (chat/messages) */
export const MessagePageGuard = createPageTypeGuard('message');

/** Guard that matches gmail-type pages (email integration) */
export const GmailPageGuard = createPageTypeGuard('gmail');

/** Guard that matches json-type pages (JSON data documents) */
export const JsonPageGuard = createPageTypeGuard('json');

import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of, switchMap, map, catchError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotebookService } from '../services/notebook.service';
import { isLocalNotebook } from '../providers/data-provider.interface';

interface PublicInfo {
  isPublic: boolean;
  notebookSlug: string;
  pageSlug?: string;
}

/**
 * Guard that intercepts ID-based notebook routes to:
 * 1. Wait for IndexedDB cache, check if notebook is there
 * 2. If not cached, wait for HTTP fetch, check again
 * 3. If still not found, check if it's a public notebook for redirect
 * 4. If not public and unauthenticated, redirect to login
 */
export const NotebookGuard: CanMatchFn = (route, segments: UrlSegment[]) => {
  const auth = inject(AuthService);
  const http = inject(HttpClient);
  const router = inject(Router);
  const notebookService = inject(NotebookService);

  const notebookId = segments[0]?.path;
  if (!notebookId) {
    return false;
  }

  // Local notebook IDs don't need public redirect / auth checks — let them
  // fall through to the HomeComponent children.
  if (isLocalNotebook(notebookId)) {
    return false;
  }

  // Quick reject: only MongoDB ObjectIds (24 hex chars) are valid notebook IDs.
  // This avoids unnecessary checks for literal routes like /settings.
  if (!/^[0-9a-fA-F]{24}$/.test(notebookId)) {
    return false;
  }

  const pageId = segments[1]?.path;

  // Step 1: Wait for IndexedDB cache to load, then check
  return notebookService.cacheReady$.pipe(
    switchMap(() => {
      if (notebookService.getNotebookById(notebookId)) {
        return of(false as boolean | ReturnType<Router['createUrlTree']>);
      }

      // If not authenticated, skip waiting for HTTP — go straight to public check
      if (!auth.isAuthenticated()) {
        return checkPublicOrRedirect(http, auth, router, notebookId, pageId, segments);
      }

      // Step 2: Wait for HTTP fetch to complete, then check
      return notebookService.httpReady$.pipe(
        switchMap(() => {
          if (notebookService.getNotebookById(notebookId)) {
            return of(false as boolean | ReturnType<Router['createUrlTree']>);
          }

          // Step 3: Not in user's notebooks — check if it's a public notebook
          return checkPublicOrRedirect(http, auth, router, notebookId, pageId, segments);
        }),
      );
    }),
  );
};

function checkPublicOrRedirect(
  http: HttpClient,
  auth: AuthService,
  router: Router,
  notebookId: string,
  pageId: string | undefined,
  segments: UrlSegment[],
) {
  const url = pageId
    ? `/api/public/notebook-info/${notebookId}?pageId=${pageId}`
    : `/api/public/notebook-info/${notebookId}`;

  return http.get<PublicInfo>(url).pipe(
    map((info) => {
      if (info.isPublic) {
        const segs = ['!', info.notebookSlug];
        if (info.pageSlug) {
          segs.push(info.pageSlug);
        }
        return router.createUrlTree(segs);
      }
      return handleNotFound(auth, router, segments);
    }),
    catchError(() => {
      return of(handleNotFound(auth, router, segments));
    }),
  );
}

function handleNotFound(auth: AuthService, router: Router, segments: UrlSegment[]) {
  if (!auth.isAuthenticated()) {
    const returnUrl = segments.map((s) => s.path).join('/');
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl },
    });
  }
  // Authenticated but notebook not found — redirect to root
  return router.createUrlTree(['/']);
}

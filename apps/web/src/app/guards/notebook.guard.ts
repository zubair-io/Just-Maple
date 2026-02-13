import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of, switchMap, map, catchError } from 'rxjs';
import { AuthService } from '../services/auth.service';

interface PublicInfo {
  isPublic: boolean;
  notebookSlug: string;
  pageSlug?: string;
}

/**
 * Guard that intercepts ID-based notebook routes to:
 * 1. Redirect public notebooks to their slug-based URL (/!/slug/slug)
 * 2. Allow authenticated users to access private notebooks (returns false to fall through)
 * 3. Redirect unauthenticated users to /login with returnUrl for private notebooks
 *
 * This guard is used as canMatch on a top-level route so it runs before the
 * auth-protected route tree. It never returns true — it always either redirects
 * (UrlTree) or falls through (false).
 */
export const NotebookGuard: CanMatchFn = (route, segments: UrlSegment[]) => {
  const auth = inject(AuthService);
  const http = inject(HttpClient);
  const router = inject(Router);

  const notebookId = segments[0]?.path;
  if (!notebookId) {
    return false;
  }

  // Quick reject: only MongoDB ObjectIds (24 hex chars) are valid notebook IDs.
  // This avoids unnecessary HTTP calls for literal routes like /settings.
  if (!/^[0-9a-fA-F]{24}$/.test(notebookId)) {
    return false;
  }

  const pageId = segments[1]?.path;

  return auth.initReady$.pipe(
    switchMap(() => {
      const url = pageId
        ? `/api/public/notebooks/${notebookId}/public-info?pageId=${pageId}`
        : `/api/public/notebooks/${notebookId}/public-info`;

      return http.get<PublicInfo>(url).pipe(
        map((info) => {
          if (info.isPublic) {
            // Public notebooks always redirect to the slug-based URL
            const segs = ['!', info.notebookSlug];
            if (info.pageSlug) {
              segs.push(info.pageSlug);
            }
            return router.createUrlTree(segs);
          }
          // Not public — fall through to auth check below
          return handlePrivateNotebook(auth, router, segments);
        }),
        catchError(() => {
          // 404 or network error — notebook is private or doesn't exist
          return of(handlePrivateNotebook(auth, router, segments));
        }),
      );
    }),
  );
};

function handlePrivateNotebook(auth: AuthService, router: Router, segments: UrlSegment[]) {
  if (auth.isAuthenticated()) {
    // Authenticated user accessing private notebook — fall through to
    // the auth-protected route tree which will load it normally.
    return false;
  }
  // Not authenticated — redirect to login with returnUrl
  const returnUrl = segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl },
  });
}

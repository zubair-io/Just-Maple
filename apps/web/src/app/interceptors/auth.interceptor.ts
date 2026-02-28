import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';
import { isLocalNotebook } from '../providers/data-provider.interface';
import { catchError, EMPTY, switchMap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  let url = req.url;

  // Prepend API URL for /api requests in production
  if (environment.apiUrl && url.startsWith('/api')) {
    url = `${environment.apiUrl}${url}`;
  }

  // Skip auth header for certain endpoints
  const skipAuthUrls = ['/api/auth/magic-link', '/api/auth/verify', '/api/auth/passkey/login'];
  if (skipAuthUrls.some((skipUrl) => req.url.includes(skipUrl))) {
    const updatedReq = req.clone({ url });
    return next(updatedReq);
  }

  // Skip auth for non-API requests (local file operations, etc.)
  if (!req.url.startsWith('/api')) {
    const updatedReq = req.clone({ url });
    return next(updatedReq);
  }

  // Wait for auth to initialize before reading the token.
  // If the user never logs in, API requests silently don't fire.
  return authService.initReady$.pipe(
    switchMap(() => {
      const token = authService.accessToken();

      if (token) {
        const authReq = req.clone({
          url,
          setHeaders: {
            Authorization: `Bearer ${token}`,
          },
        });
        return next(authReq).pipe(
          catchError((error) => {
            if (error.status === 401) {
              console.log('[Auth] 401 Unauthorized - clearing token and redirecting to login');
              authService.clearAuthOnExpiration();
              const firstSegment = router.url.split('/').filter(Boolean)[0] ?? '';
              if (!isLocalNotebook(firstSegment)) {
                router.navigate(['/login']);
              }
            }
            return throwError(() => error);
          }),
        );
      }

      // No token after auth init — user is not logged in.
      // Silently drop the request; it would fail with 401 anyway.
      return EMPTY;
    }),
  );
};

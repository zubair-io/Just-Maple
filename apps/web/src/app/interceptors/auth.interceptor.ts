import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';
import { isLocalNotebook } from '../providers/data-provider.interface';
import { catchError, EMPTY, switchMap, throwError } from 'rxjs';
import { routeApiRequest, fallBackToPublic } from '../services/server-endpoint';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const { url, isApi } = routeApiRequest(req.url, environment.apiUrl || '');
  const send = (request: HttpRequest<unknown>) =>
    next(request).pipe(
      catchError((error) => {
        if (isApi && error.status === 0 && fallBackToPublic()) {
          // Never replay an uncertain mutation. Reads may safely retry on the public route.
          if (request.method === 'GET' || request.method === 'HEAD') {
            return next(
              request.clone({ url: routeApiRequest(req.url, environment.apiUrl || '').url }),
            );
          }
        }
        return throwError(() => error);
      }),
    );

  // Skip auth header for certain endpoints
  const skipAuthUrls = [
    '/api/auth/passkey/signup/',
    '/api/auth/passkey/login/',
    '/api/auth/dev-token',
  ];
  if (
    skipAuthUrls.some((skipUrl) => req.url.includes(skipUrl)) ||
    (isApi && new URL(url, 'https://maple.invalid').pathname.startsWith('/api/public/'))
  ) {
    const updatedReq = req.clone({ url });
    return send(updatedReq);
  }

  // Skip auth for non-API requests (local file operations, etc.)
  if (!isApi) {
    const updatedReq = req.clone({ url });
    return send(updatedReq);
  }

  // Wait for auth to initialize before reading the token.
  // If the user never logs in, API requests silently don't fire.
  return authService.initReady$.pipe(
    switchMap(() => {
      // Untracked: an effect that sends a request must not start watching the token.
      const token = untracked(() => authService.accessToken());

      if (token) {
        const authReq = req.clone({
          url,
          setHeaders: {
            Authorization: `Bearer ${token}`,
          },
        });
        return send(authReq).pipe(
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

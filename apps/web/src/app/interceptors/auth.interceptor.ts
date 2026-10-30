import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';
import { isLocalNotebook } from '../providers/data-provider.interface';
import { catchError, defer, EMPTY, switchMap, throwError, timeout, TimeoutError } from 'rxjs';
import {
  routeApiRequest,
  fallBackToPublic,
  nativeServerEndpoint,
} from '../services/server-endpoint';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const { url, isApi } = routeApiRequest(req.url, environment.apiUrl || '');
  const send = (request: HttpRequest<unknown>) =>
    defer(() => {
      const routed = request.clone({ url: routeApiRequest(req.url, environment.apiUrl || '').url });
      const native = nativeServerEndpoint();
      const attemptedLocal =
        isApi && native?.localUrl && routed.url.startsWith(`${native.localUrl}/api/`)
          ? native.localUrl
          : undefined;
      const safeRead = request.method === 'GET' || request.method === 'HEAD';
      const response = next(routed);
      // A dead LAN route may never produce a network error. Bound reads, including the
      // wait after HttpEventType.Sent. Uploads and uncertain mutations are never replayed.
      return (attemptedLocal && safeRead ? response.pipe(timeout({ each: 5000 })) : response).pipe(
        catchError((error) => {
          if (attemptedLocal && (error.status === 0 || error instanceof TimeoutError)) {
            fallBackToPublic(attemptedLocal);
            const retryURL = routeApiRequest(req.url, environment.apiUrl || '').url;
            // Other concurrent reads may already have switched the shared endpoint.
            if (safeRead && retryURL !== routed.url) return next(request.clone({ url: retryURL }));
          }
          return throwError(() => error);
        }),
      );
    });

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

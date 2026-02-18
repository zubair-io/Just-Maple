import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { getApiUrl } from '../utils/runtime-env';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.accessToken();

  let url = req.url;

  // Prepend API URL for production or when targeting remote server
  const apiUrl = getApiUrl();
  if (apiUrl && url.startsWith('/api')) {
    url = `${apiUrl}${url}`;
  }

  // Skip auth header for certain endpoints
  const skipAuthUrls = ['/api/auth/magic-link', '/api/auth/verify'];
  if (skipAuthUrls.some((skipUrl) => req.url.includes(skipUrl))) {
    const updatedReq = req.clone({ url });
    return next(updatedReq);
  }

  if (token) {
    const authReq = req.clone({
      url,
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
    return next(authReq).pipe(
      catchError((error) => {
        // On 401, clear auth and redirect (avoid circular dependency by not calling authService.logout())
        if (error.status === 401) {
          console.log('[Auth] 401 Unauthorized - clearing token and redirecting to login');
          // Clear token directly via the service's internal signal (doesn't trigger HTTP call)
          authService.clearAuthOnExpiration();
          router.navigate(['/login']);
        }
        return throwError(() => error);
      }),
    );
  }

  const updatedReq = req.clone({ url });
  return next(updatedReq);
};

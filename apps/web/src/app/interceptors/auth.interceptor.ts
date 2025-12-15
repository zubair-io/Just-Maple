import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (
    req: HttpRequest<unknown>,
    next: HttpHandlerFn,
) => {
    const authService = inject(AuthService);
    const token = authService.accessToken();

    let url = req.url;

    // Prepend API URL for /api requests in production
    if (environment.apiUrl && url.startsWith('/api')) {
        url = `${environment.apiUrl}${url}`;
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
        return next(authReq);
    }

    const updatedReq = req.clone({ url });
    return next(updatedReq);
};

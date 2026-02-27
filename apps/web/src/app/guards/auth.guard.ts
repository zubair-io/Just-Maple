import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  CanMatch,
  CanMatchFn,
  Router,
  UrlTree,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { isLocalNotebook } from '../providers/data-provider.interface';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate, CanMatch {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(route?: ActivatedRouteSnapshot, state?: RouterStateSnapshot): boolean | UrlTree {
    if (this.authService.isAuthenticated()) {
      return true;
    }
    const queryParams: Record<string, string> = {};
    if (state?.url && state.url !== '/') {
      queryParams['returnUrl'] = state.url;
    }
    return this.router.createUrlTree(['/login'], { queryParams });
  }

  canMatch(): Observable<boolean> {
    // Wait for auth initialization to complete before checking authentication
    return this.authService.initReady$.pipe(map(() => this.authService.isAuthenticated()));
  }
}

@Injectable({
  providedIn: 'root',
})
export class PublicGuard implements CanActivate, CanMatch {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(): boolean | UrlTree {
    if (!this.authService.isAuthenticated()) {
      return true;
    }
    return this.router.createUrlTree(['/']);
  }

  canMatch(): Observable<boolean> {
    // Wait for auth initialization to complete before checking authentication
    return this.authService.initReady$.pipe(map(() => !this.authService.isAuthenticated()));
  }
}

/**
 * Guard that allows access to HomeComponent for all users.
 * Local notebook IDs pass through immediately; everything else
 * waits for auth init so HomeComponent can accurately check isAuthenticated().
 */
export const AppLayoutGuard: CanMatchFn = (route, segments) => {
  const auth = inject(AuthService);
  const firstSegment = segments[0]?.path ?? '';

  // Allow local notebook IDs through without waiting for auth
  if (isLocalNotebook(firstSegment)) {
    return of(true);
  }

  // Wait for auth init, then always allow through.
  // HomeComponent gates cloud-only logic behind isAuthenticated().
  return auth.initReady$.pipe(map(() => true));
};

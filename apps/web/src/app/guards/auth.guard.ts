import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  CanMatch,
  Router,
  UrlTree,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { Observable, map } from 'rxjs';
import { AuthService } from '../services/auth.service';

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

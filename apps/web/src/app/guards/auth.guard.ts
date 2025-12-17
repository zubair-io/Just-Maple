import { Injectable, inject } from '@angular/core';
import { CanActivate, CanMatch, Router, UrlTree } from '@angular/router';
import { Observable, map } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate, CanMatch {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(): boolean | UrlTree {
    if (this.authService.isAuthenticated()) {
      return true;
    }
    return this.router.createUrlTree(['/login']);
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

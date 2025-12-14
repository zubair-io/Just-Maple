import { Injectable, inject } from '@angular/core';
import { CanActivate, CanMatch, Router, UrlTree } from '@angular/router';
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

  canMatch(): boolean {
    // For canMatch, just return boolean - don't redirect
    // This allows route matching to fall through to next route
    return this.authService.isAuthenticated();
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

  canMatch(): boolean {
    // For canMatch, just return boolean
    return !this.authService.isAuthenticated();
  }
}

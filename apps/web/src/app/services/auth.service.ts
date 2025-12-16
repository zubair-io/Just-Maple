import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { UserResponse, AuthResponse, MagicLinkResponse } from '@maple/shared';
import { IndexedDBService } from './indexed-db.service';

interface PasskeyInfo {
  id: string;
  visibleId: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
}

interface StoredAuth {
  accessToken: string;
  user: UserResponse;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly indexedDB = inject(IndexedDBService);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<UserResponse | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly accessToken = this._accessToken.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isAuthenticated = computed(() => !!this._accessToken());

  // Check if passkeys are supported (WebAuthn requires HTTPS or localhost)
  readonly supportsPasskeys = computed(() => {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    return browserSupportsWebAuthn();
  });

  constructor() {
    this.initFromStorage();
  }

  private initFromStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const stored = localStorage.getItem('auth');
    if (stored) {
      try {
        const auth: StoredAuth = JSON.parse(stored);
        this._accessToken.set(auth.accessToken);
        this._user.set(auth.user);
      } catch {
        localStorage.removeItem('auth');
      }
    }
  }

  private saveToStorage(auth: StoredAuth): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('auth', JSON.stringify(auth));
    }
  }

  private clearStorage(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('auth');
    }
  }

  async requestMagicLink(email: string): Promise<MagicLinkResponse> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<MagicLinkResponse>('/api/auth/magic-link', { email }),
      );
      return response;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to send magic link';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async verifyToken(token: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<AuthResponse>('/api/auth/verify', {
          params: { token },
        }),
      );

      this._accessToken.set(response.accessToken);
      this._user.set(response.user);
      this.saveToStorage({
        accessToken: response.accessToken,
        user: response.user,
      });

      await this.router.navigate(['/']);
    } catch (err: any) {
      const message = err?.error?.error || 'Verification failed';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async verifyCode(email: string, code: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<AuthResponse>('/api/auth/verify-code', { email, code }),
      );

      this._accessToken.set(response.accessToken);
      this._user.set(response.user);
      this.saveToStorage({
        accessToken: response.accessToken,
        user: response.user,
      });

      await this.router.navigate(['/']);
    } catch (err: any) {
      const message = err?.error?.error || 'Invalid or expired code';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async fetchCurrentUser(): Promise<UserResponse | null> {
    if (!this._accessToken()) {
      return null;
    }

    try {
      const response = await firstValueFrom(this.http.get<{ user: UserResponse }>('/api/auth/me'));
      this._user.set(response.user);
      return response.user;
    } catch {
      this.logout();
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Ignore errors during logout
    }

    this._accessToken.set(null);
    this._user.set(null);
    this.clearStorage();

    // Clear all cached data from IndexedDB
    try {
      await this.indexedDB.clearAll();
    } catch {
      // Ignore IndexedDB errors during logout
    }

    await this.router.navigate(['/login']);
  }

  // ============ PASSKEY METHODS ============

  async registerPasskey(): Promise<PasskeyInfo> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      // Get registration options from server
      const options = await firstValueFrom(
        this.http.post<PublicKeyCredentialCreationOptionsJSON>(
          '/api/auth/passkey/register/start',
          {},
        ),
      );

      // Start WebAuthn registration in browser
      const credential = await startRegistration({ optionsJSON: options });

      // Send credential to server
      const result = await firstValueFrom(
        this.http.post<{ verified: boolean; passkey: PasskeyInfo }>(
          '/api/auth/passkey/register/finish',
          credential,
        ),
      );

      return result.passkey;
    } catch (err: any) {
      const message = err?.error?.error || err?.message || 'Failed to register passkey';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async loginWithPasskey(email?: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      // Get authentication options from server
      const options = await firstValueFrom(
        this.http.post<PublicKeyCredentialRequestOptionsJSON>(
          '/api/auth/passkey/login/start',
          email ? { email } : {},
        ),
      );

      // Start WebAuthn authentication in browser
      const credential = await startAuthentication({ optionsJSON: options });

      // Send credential to server
      const response = await firstValueFrom(
        this.http.post<AuthResponse & { verified: boolean }>(
          '/api/auth/passkey/login/finish',
          credential,
        ),
      );

      this._accessToken.set(response.accessToken);
      this._user.set(response.user);
      this.saveToStorage({
        accessToken: response.accessToken,
        user: response.user,
      });

      await this.router.navigate(['/']);
    } catch (err: any) {
      const message = err?.error?.error || err?.message || 'Passkey login failed';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async getPasskeys(): Promise<PasskeyInfo[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ passkeys: PasskeyInfo[] }>('/api/auth/passkeys'),
      );
      return response.passkeys;
    } catch {
      return [];
    }
  }
}

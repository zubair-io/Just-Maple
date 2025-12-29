import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, take, Observable, ReplaySubject } from 'rxjs';
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
import { NativeBridgeService } from './native-bridge.service';

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
  private readonly nativeBridge = inject(NativeBridgeService);

  /**
   * Get storage key for current origin (allows separate auth per server)
   */
  private getStorageKey(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return 'auth';
    }
    // Use origin as part of key to keep auth separate per server
    const origin = window.location.origin;
    return `auth:${origin}`;
  }

  /**
   * Get server identifier for native keychain (uses server URL from initial state or origin)
   */
  private getNativeServerId(): string {
    const initialState = this.nativeBridge.getInitialState();
    return initialState?.serverUrl || window.location.origin;
  }

  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<UserResponse | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isInitReady = signal(false);

  // ReplaySubject ensures late subscribers get the ready state
  private readonly _initReady$ = new ReplaySubject<boolean>(1);

  readonly accessToken = this._accessToken.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isInitReady = this._isInitReady.asReadonly();

  /** Observable that emits true once auth initialization is complete */
  readonly initReady$ = this._initReady$.asObservable();

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

  private async initFromStorage(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.markInitReady();
      return;
    }

    // If running in native app, get token from native keychain
    if (this.nativeBridge.isNativeApp()) {
      const serverId = this.getNativeServerId();
      console.log(
        '[Auth] Running in native app, requesting token from keychain for server:',
        serverId,
      );
      this.nativeBridge.getToken(serverId);

      // Wait for token response
      try {
        const response = await firstValueFrom(this.nativeBridge.onCurrentToken().pipe(take(1)));

        if (response.token) {
          console.log('[Auth] Token received from native keychain');
          // We have the token from native, but we still need the user data
          // Try to get it from localStorage first
          const stored = localStorage.getItem(this.getStorageKey());
          if (stored) {
            try {
              const auth: StoredAuth = JSON.parse(stored);
              this._accessToken.set(response.token);
              this._user.set(auth.user);
              this.markInitReady();
              return;
            } catch {
              // Failed to parse, will fetch user from server
            }
          }

          // Set token and fetch user from server
          this._accessToken.set(response.token);
          await this.fetchCurrentUser();
        }
      } catch {
        console.log('[Auth] No token in native keychain');
      }
      this.markInitReady();
      return;
    }

    // Web app: use localStorage
    const stored = localStorage.getItem(this.getStorageKey());
    if (stored) {
      try {
        const auth: StoredAuth = JSON.parse(stored);
        this._accessToken.set(auth.accessToken);
        this._user.set(auth.user);
      } catch {
        localStorage.removeItem(this.getStorageKey());
      }
    }
    this.markInitReady();

    // Defer token refresh until after service initialization completes
    // This avoids circular dependency with the HTTP interceptor
    if (stored) {
      queueMicrotask(() => {
        this.refreshToken().catch(() => {
          // If refresh fails (token expired), fetch current user as fallback
          this.fetchCurrentUser().catch(() => {});
        });
      });
    }
  }

  private markInitReady(): void {
    this._isInitReady.set(true);
    this._initReady$.next(true);
    this._initReady$.complete();
  }

  private saveToStorage(auth: StoredAuth): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Always save to localStorage for user data
    localStorage.setItem(this.getStorageKey(), JSON.stringify(auth));

    // If running in native app, also save token to native keychain
    if (this.nativeBridge.isNativeApp()) {
      const serverId = this.getNativeServerId();
      console.log('[Auth] Saving token to native keychain for server:', serverId);
      this.nativeBridge.saveToken(auth.accessToken, serverId);
    }
  }

  private clearStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    localStorage.removeItem(this.getStorageKey());

    // If running in native app, also clear token from native keychain
    if (this.nativeBridge.isNativeApp()) {
      const serverId = this.getNativeServerId();
      console.log('[Auth] Clearing token from native keychain for server:', serverId);
      this.nativeBridge.clearToken(serverId);
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

      // Update storage with fresh user data
      const token = this._accessToken();
      if (token) {
        this.saveToStorage({ accessToken: token, user: response.user });
      }

      return response.user;
    } catch {
      return null;
    }
  }

  /**
   * Refresh the access token to extend the session by 14 days.
   * Call this when the user opens the app with a valid token.
   */
  async refreshToken(): Promise<boolean> {
    const currentToken = this._accessToken();
    if (!currentToken) {
      return false;
    }

    try {
      const response = await firstValueFrom(this.http.post<AuthResponse>('/api/auth/refresh', {}));

      this._accessToken.set(response.accessToken);
      this._user.set(response.user);
      this.saveToStorage({
        accessToken: response.accessToken,
        user: response.user,
      });

      console.log('[Auth] Token refreshed successfully');
      return true;
    } catch (error) {
      console.log('[Auth] Token refresh failed:', error);
      return false;
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

  /**
   * Clear authentication state when token expires (called by interceptor on 401).
   * Does not make HTTP call to avoid circular dependency.
   * Does not navigate - the interceptor handles navigation.
   */
  clearAuthOnExpiration(): void {
    this._accessToken.set(null);
    this._user.set(null);
    this.clearStorage();

    // Clear all cached data from IndexedDB
    try {
      this.indexedDB.clearAll().catch(() => {
        // Ignore IndexedDB errors
      });
    } catch {
      // Ignore errors
    }
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

  async updateDisplayName(displayName: string | undefined): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.patch<{ user: { _id: string; email: string; displayName?: string } }>(
          '/api/auth/me',
          { displayName },
        ),
      );

      // Update user signal with new display name
      const currentUser = this._user();
      if (currentUser) {
        const updatedUser = { ...currentUser, displayName: response.user.displayName };
        this._user.set(updatedUser);

        // Update storage with fresh user data
        const token = this._accessToken();
        if (token) {
          this.saveToStorage({ accessToken: token, user: updatedUser });
        }
      }
    } catch (error: any) {
      throw new Error(error?.message || 'Failed to update display name');
    }
  }

  async uploadProfilePicture(file: File): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.post<{
          user: { _id: string; email: string; displayName?: string; profilePictureUrl?: string };
        }>('/api/auth/me/profile-picture', file, {
          headers: {
            'Content-Type': file.type,
          },
        }),
      );

      // Update user signal with new profile picture
      const currentUser = this._user();
      if (currentUser) {
        const updatedUser = {
          ...currentUser,
          displayName: response.user.displayName,
          profilePictureUrl: response.user.profilePictureUrl,
        };
        this._user.set(updatedUser);

        // Update storage with fresh user data
        const token = this._accessToken();
        if (token) {
          this.saveToStorage({ accessToken: token, user: updatedUser });
        }
      }
    } catch (error: any) {
      throw new Error(error?.message || 'Failed to upload profile picture');
    }
  }
}

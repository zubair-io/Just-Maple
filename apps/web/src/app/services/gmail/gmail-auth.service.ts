import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, from, throwError, of } from 'rxjs';
import { map, switchMap, tap, catchError, take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { IndexedDBService } from '../indexed-db.service';
import { GmailCryptoService } from './gmail-crypto.service';
import { AuthService } from '../auth.service';
import { NativeBridgeService } from '../native-bridge.service';
import { DB_STORES } from '../db-stores';
import { environment } from '../../../environments/environment';
import type { GmailTokens } from '@maple/shared';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleUserInfo {
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Service for handling Google OAuth 2.0 authentication for Gmail access.
 *
 * Uses the OAuth 2.0 Authorization Code flow with PKCE for security.
 * Tokens are encrypted and stored locally in IndexedDB - never sent to Maple servers.
 */
@Injectable({ providedIn: 'root' })
export class GmailAuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly crypto = inject(GmailCryptoService);
  private readonly authService = inject(AuthService);
  private readonly nativeBridge = inject(NativeBridgeService);

  private readonly GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private readonly GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
  private readonly NATIVE_CALLBACK_SCHEME = 'justmaple';

  private get redirectUri(): string {
    if (isPlatformBrowser(this.platformId) && this.nativeBridge.isNativeApp()) {
      return `${this.NATIVE_CALLBACK_SCHEME}://gmail/oauth/callback`;
    }
    return `${window.location.origin}/gmail/oauth/callback`;
  }

  // State
  private readonly _isConnected = signal(false);
  private readonly _connectedEmail = signal<string | null>(null);
  private readonly _isAuthenticating = signal(false);

  readonly isConnected = this._isConnected.asReadonly();
  readonly connectedEmail = this._connectedEmail.asReadonly();
  readonly isAuthenticating = this._isAuthenticating.asReadonly();

  // In-memory token cache for current session
  private currentTokens: GmailTokens | null = null;

  // Cached client ID fetched from API (fetched once per session)
  private clientIdPromise: Promise<string> | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeFromStorage();
    }
  }

  /**
   * Fetch and cache the Google OAuth client ID from the API.
   */
  private getClientId(): Promise<string> {
    if (!this.clientIdPromise) {
      this.clientIdPromise = firstValueFrom(
        this.http.get<{ clientId: string }>('/api/gmail/config'),
      ).then((res) => res.clientId);
    }
    return this.clientIdPromise;
  }

  /**
   * Initialize crypto and check for existing connection on startup.
   */
  private async initializeFromStorage(): Promise<void> {
    const user = this.authService.user();
    if (!user) return;

    await this.crypto.initializeKey(user._id);

    const tokens = await this.getStoredTokens();
    if (tokens) {
      this._isConnected.set(true);
      this._connectedEmail.set(tokens.accountEmail);
      this.currentTokens = tokens;
    }
  }

  /**
   * Start the OAuth flow by opening a popup window to Google.
   * Uses PKCE for additional security.
   */
  authenticate(): Observable<{ email: string }> {
    if (!isPlatformBrowser(this.platformId)) {
      return throwError(() => new Error('OAuth not available in this environment'));
    }

    this._isAuthenticating.set(true);

    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier();
    const state = crypto.randomUUID();

    // Store verifier and state for callback validation
    sessionStorage.setItem('gmail_code_verifier', codeVerifier);
    sessionStorage.setItem('gmail_oauth_state', state);

    return from(this.getClientId()).pipe(
      switchMap((clientId) => {
        if (!clientId) {
          return throwError(() => new Error('Google OAuth client ID not configured'));
        }
        return from(this.generateCodeChallenge(codeVerifier)).pipe(
          map((codeChallenge) => ({ clientId, codeChallenge })),
        );
      }),
      switchMap(({ clientId, codeChallenge }) => {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: this.redirectUri,
          response_type: 'code',
          scope: environment.google.scopes.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });

        const authUrl = `${this.GOOGLE_AUTH_URL}?${params.toString()}`;

        return this.openOAuthPopup(authUrl, state);
      }),
      switchMap((code) => this.exchangeCodeForTokens(code)),
      switchMap((tokens) => this.fetchUserInfoAndStore(tokens)),
      tap((result) => {
        this._isConnected.set(true);
        this._connectedEmail.set(result.email);
        this._isAuthenticating.set(false);
      }),
      catchError((error) => {
        this._isAuthenticating.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Open OAuth popup and wait for callback.
   * Uses ASWebAuthenticationSession on native apps, browser popup otherwise.
   */
  private openOAuthPopup(authUrl: string, expectedState: string): Observable<string> {
    if (this.nativeBridge.isNativeApp()) {
      return this.openNativeAuthSession(authUrl, expectedState);
    }

    return this.openBrowserPopup(authUrl, expectedState);
  }

  /**
   * Native app flow: use ASWebAuthenticationSession via native bridge.
   */
  private openNativeAuthSession(authUrl: string, expectedState: string): Observable<string> {
    return new Observable((observer) => {
      const sub = this.nativeBridge
        .onAuthSessionResult()
        .pipe(take(1))
        .subscribe((result) => {
          if (result.error) {
            observer.error(new Error(result.error));
            return;
          }

          if (!result.url) {
            observer.error(new Error('No callback URL received'));
            return;
          }

          const callbackUrl = new URL(result.url);
          const code = callbackUrl.searchParams.get('code');
          const state = callbackUrl.searchParams.get('state');
          const error = callbackUrl.searchParams.get('error');

          if (error) {
            observer.error(new Error(error));
          } else if (state !== expectedState) {
            observer.error(new Error('OAuth state mismatch'));
          } else if (!code) {
            observer.error(new Error('No authorization code received'));
          } else {
            observer.next(code);
            observer.complete();
          }
        });

      this.nativeBridge.openAuthSession(authUrl, this.NATIVE_CALLBACK_SCHEME);

      return () => sub.unsubscribe();
    });
  }

  /**
   * Browser flow: open popup window and listen for postMessage.
   */
  private openBrowserPopup(authUrl: string, expectedState: string): Observable<string> {
    return new Observable((observer) => {
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'gmail_oauth',
        `width=${width},height=${height},left=${left},top=${top},popup=1`,
      );

      if (!popup) {
        observer.error(new Error('Failed to open OAuth popup. Please allow popups.'));
        return;
      }

      // Listen for message from callback page
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === 'gmail_oauth_callback') {
          window.removeEventListener('message', handleMessage);
          clearInterval(checkClosed);
          popup.close();

          if (event.data.error) {
            observer.error(new Error(event.data.error));
          } else if (event.data.state !== expectedState) {
            observer.error(new Error('OAuth state mismatch'));
          } else {
            observer.next(event.data.code);
            observer.complete();
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed manually
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          observer.error(new Error('OAuth popup was closed'));
        }
      }, 500);
    });
  }

  /**
   * Exchange authorization code for tokens.
   */
  private exchangeCodeForTokens(code: string): Observable<GoogleTokenResponse> {
    const codeVerifier = sessionStorage.getItem('gmail_code_verifier');

    if (!codeVerifier) {
      return throwError(() => new Error('Code verifier not found'));
    }

    // Clean up session storage
    sessionStorage.removeItem('gmail_code_verifier');
    sessionStorage.removeItem('gmail_oauth_state');

    return from(this.getClientId()).pipe(
      switchMap((clientId) => {
        const params = new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri,
        });

        return from(
          fetch(this.GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          }),
        );
      }),
      switchMap((response) => {
        if (!response.ok) {
          return from(response.json()).pipe(
            switchMap((error) =>
              throwError(() => new Error(error.error_description || 'Token exchange failed')),
            ),
          );
        }
        return from(response.json()) as Observable<GoogleTokenResponse>;
      }),
    );
  }

  /**
   * Fetch user info and store tokens.
   */
  private fetchUserInfoAndStore(tokens: GoogleTokenResponse): Observable<{ email: string }> {
    return from(
      fetch(this.GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }),
    ).pipe(
      switchMap((response) => {
        if (!response.ok) {
          return throwError(() => new Error('Failed to fetch user info'));
        }
        return from(response.json()) as Observable<GoogleUserInfo>;
      }),
      switchMap((userInfo) => {
        const gmailTokens: GmailTokens = {
          accountEmail: userInfo.email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || '',
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          tokenType: tokens.token_type,
          scope: tokens.scope,
        };

        return from(this.storeTokens(gmailTokens)).pipe(map(() => ({ email: userInfo.email })));
      }),
    );
  }

  /**
   * Store tokens encrypted in IndexedDB.
   */
  private async storeTokens(tokens: GmailTokens): Promise<void> {
    const encryptedTokens = {
      accountEmail: tokens.accountEmail,
      accessToken: await this.crypto.encrypt(tokens.accessToken),
      refreshToken: await this.crypto.encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
    };

    await this.indexedDB.put(encryptedTokens, DB_STORES.GMAIL_TOKENS);
    this.currentTokens = tokens;
  }

  /**
   * Get stored tokens (decrypted).
   */
  private async getStoredTokens(): Promise<GmailTokens | null> {
    const user = this.authService.user();
    if (!user) return null;

    const stored = await this.indexedDB.getAll<{
      accountEmail: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: string;
      tokenType?: string;
      scope?: string;
    }>(DB_STORES.GMAIL_TOKENS);

    if (stored.length === 0) return null;

    const encryptedTokens = stored[0];

    try {
      return {
        accountEmail: encryptedTokens.accountEmail,
        accessToken: await this.crypto.decrypt(encryptedTokens.accessToken),
        refreshToken: await this.crypto.decrypt(encryptedTokens.refreshToken),
        expiresAt: encryptedTokens.expiresAt,
        tokenType: encryptedTokens.tokenType,
        scope: encryptedTokens.scope,
      };
    } catch {
      // Decryption failed - tokens are invalid
      await this.clearTokens();
      return null;
    }
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getAccessToken(): Promise<string> {
    if (!this.currentTokens) {
      this.currentTokens = await this.getStoredTokens();
    }

    if (!this.currentTokens) {
      throw new Error('No Gmail tokens available. Please connect Gmail first.');
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = new Date(this.currentTokens.expiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    if (now + bufferMs >= expiresAt) {
      await this.refreshAccessToken();
    }

    return this.currentTokens.accessToken;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.currentTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = await this.getClientId();
    const params = new URLSearchParams({
      client_id: clientId,
      refresh_token: this.currentTokens.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(this.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.error === 'invalid_grant') {
        // Refresh token revoked - need to re-authenticate
        await this.disconnect();
        throw new Error('Gmail access was revoked. Please reconnect.');
      }
      throw new Error(error.error_description || 'Token refresh failed');
    }

    const tokens: GoogleTokenResponse = await response.json();

    this.currentTokens = {
      ...this.currentTokens,
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };

    await this.storeTokens(this.currentTokens);
  }

  /**
   * Disconnect Gmail - remove all local data.
   */
  async disconnect(): Promise<void> {
    const user = this.authService.user();

    // Clear all Gmail-related stores
    await this.clearTokens();
    await this.indexedDB.clear(DB_STORES.GMAIL_EMAILS);
    await this.indexedDB.clear(DB_STORES.GMAIL_SYNC_STATE);
    await this.indexedDB.clear(DB_STORES.GMAIL_DRAFTS);

    // Clear crypto data
    if (user) {
      this.crypto.clearUserData(user._id);
    }

    this.currentTokens = null;
    this._isConnected.set(false);
    this._connectedEmail.set(null);
  }

  /**
   * Clear stored tokens.
   */
  private async clearTokens(): Promise<void> {
    await this.indexedDB.clear(DB_STORES.GMAIL_TOKENS);
    this.currentTokens = null;
  }

  /**
   * Generate PKCE code verifier.
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  /**
   * Generate PKCE code challenge from verifier.
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  /**
   * Base64 URL encode a byte array.
   */
  private base64UrlEncode(array: Uint8Array): string {
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Check if Gmail is connected for the current user.
   */
  async checkConnection(): Promise<boolean> {
    const tokens = await this.getStoredTokens();
    const connected = tokens !== null;
    this._isConnected.set(connected);
    this._connectedEmail.set(tokens?.accountEmail || null);
    return connected;
  }
}

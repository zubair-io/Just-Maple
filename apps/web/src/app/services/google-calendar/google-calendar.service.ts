import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { map, switchMap, tap, catchError, take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { IndexedDBService } from '../indexed-db.service';
import { GmailCryptoService } from '../gmail/gmail-crypto.service';
import { AuthService } from '../auth.service';
import { NativeBridgeService } from '../native-bridge.service';
import { DB_STORES } from '../db-stores';
import { environment } from '../../../environments/environment';
import type { GoogleCalendarEvent, GoogleCalendarEntry } from '@maple/shared';

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

interface StoredCalendarTokens {
  accountEmail: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenType?: string;
  scope?: string;
}

/**
 * Service for Google Calendar OAuth 2.0 authentication and API access.
 * Handles OAuth flow with PKCE, token management, and calendar/event fetching.
 * Tokens are encrypted and stored locally - never sent to Maple servers.
 */
@Injectable({ providedIn: 'root' })
export class GoogleCalendarService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly crypto = inject(GmailCryptoService);
  private readonly authService = inject(AuthService);
  private readonly nativeBridge = inject(NativeBridgeService);

  private readonly GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private readonly GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
  private readonly GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
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

  // In-memory token cache
  private currentTokens: StoredCalendarTokens | null = null;

  // Cached client ID (fetched once per session)
  private clientIdPromise: Promise<string> | null = null;

  // In-memory event cache keyed by "calendarId|startDate|endDate"
  private eventCache = new Map<string, { events: GoogleCalendarEvent[]; fetchedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeFromStorage();
    }
  }

  private getClientId(): Promise<string> {
    if (!this.clientIdPromise) {
      this.clientIdPromise = firstValueFrom(
        this.http.get<{ clientId: string }>('/api/google-calendar/config'),
      ).then((res) => res.clientId);
    }
    return this.clientIdPromise;
  }

  private async initializeFromStorage(): Promise<void> {
    const user = this.authService.user();
    if (!user) return;

    await this.ensureCryptoInitialized();

    const tokens = await this.getStoredTokens();
    if (tokens) {
      this._isConnected.set(true);
      this._connectedEmail.set(tokens.accountEmail);
      this.currentTokens = tokens;
    }
  }

  private async ensureCryptoInitialized(): Promise<void> {
    if (this.crypto.isInitialized()) return;
    const user = this.authService.user();
    if (!user) throw new Error('No authenticated user');
    await this.crypto.initializeKey(user._id);
  }

  /**
   * Start the Google Calendar OAuth flow.
   */
  authenticate(): Observable<{ email: string }> {
    if (!isPlatformBrowser(this.platformId)) {
      return throwError(() => new Error('OAuth not available in this environment'));
    }

    this._isAuthenticating.set(true);

    const codeVerifier = this.generateCodeVerifier();
    const state = crypto.randomUUID();

    sessionStorage.setItem('gcal_code_verifier', codeVerifier);
    sessionStorage.setItem('gcal_oauth_state', state);

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
          scope: environment.google.calendarScopes.join(' '),
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

  private openOAuthPopup(authUrl: string, expectedState: string): Observable<string> {
    if (this.nativeBridge.isNativeApp()) {
      return this.openNativeAuthSession(authUrl, expectedState);
    }
    return this.openBrowserPopup(authUrl, expectedState);
  }

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

  private openBrowserPopup(authUrl: string, expectedState: string): Observable<string> {
    return new Observable((observer) => {
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'gcal_oauth',
        `width=${width},height=${height},left=${left},top=${top},popup=1`,
      );

      if (!popup) {
        observer.error(new Error('Failed to open OAuth popup. Please allow popups.'));
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'gmail_oauth_callback') {
          cleanup();
          if (event.data.error) {
            observer.error(new Error(event.data.error));
          } else if (event.data.state !== expectedState) {
            observer.error(new Error('OAuth state mismatch'));
          } else if (!event.data.code) {
            observer.error(new Error('Missing authorization code'));
          } else {
            observer.next(event.data.code);
            observer.complete();
          }
        }
      };

      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          cleanup();
          observer.error(new Error('OAuth popup was closed'));
        }
      }, 500);

      const cleanup = () => {
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosed);
        if (!popup.closed) popup.close();
      };

      return cleanup;
    });
  }

  private exchangeCodeForTokens(code: string): Observable<GoogleTokenResponse> {
    const codeVerifier = sessionStorage.getItem('gcal_code_verifier');
    if (!codeVerifier) {
      return throwError(() => new Error('Code verifier not found'));
    }

    sessionStorage.removeItem('gcal_code_verifier');
    sessionStorage.removeItem('gcal_oauth_state');

    return from(this.getClientId()).pipe(
      switchMap((clientId) => {
        if (!clientId) {
          return throwError(() => new Error('Google OAuth client ID not configured'));
        }

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
        const storedTokens: StoredCalendarTokens = {
          accountEmail: userInfo.email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || '',
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          tokenType: tokens.token_type,
          scope: tokens.scope,
        };

        return from(this.storeTokens(storedTokens)).pipe(map(() => ({ email: userInfo.email })));
      }),
    );
  }

  private async storeTokens(tokens: StoredCalendarTokens): Promise<void> {
    await this.ensureCryptoInitialized();
    const encryptedTokens = {
      accountEmail: tokens.accountEmail,
      accessToken: await this.crypto.encrypt(tokens.accessToken),
      refreshToken: await this.crypto.encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
    };

    await this.indexedDB.put(encryptedTokens, DB_STORES.GOOGLE_CALENDAR_TOKENS);
    this.currentTokens = tokens;
  }

  private async getStoredTokens(): Promise<StoredCalendarTokens | null> {
    const user = this.authService.user();
    if (!user) return null;

    await this.ensureCryptoInitialized();

    const stored = await this.indexedDB.getAll<StoredCalendarTokens>(
      DB_STORES.GOOGLE_CALENDAR_TOKENS,
    );

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
      await this.clearTokens();
      return null;
    }
  }

  async getAccessToken(): Promise<string> {
    if (!this.currentTokens) {
      this.currentTokens = await this.getStoredTokens();
    }

    if (!this.currentTokens) {
      throw new Error('No Google Calendar tokens available. Please connect first.');
    }

    // Refresh if expired (with 5 minute buffer)
    const expiresAt = new Date(this.currentTokens.expiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    if (now + bufferMs >= expiresAt) {
      await this.refreshAccessToken();
    }

    return this.currentTokens.accessToken;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.currentTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = await this.getClientId();
    if (!clientId) {
      throw new Error('Google OAuth client ID not configured');
    }

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
        await this.disconnect();
        throw new Error('Google Calendar access was revoked. Please reconnect.');
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

  async disconnect(): Promise<void> {
    await this.clearTokens();
    await this.indexedDB.clear(DB_STORES.GOOGLE_CALENDAR_EVENTS);
    this.eventCache.clear();
    this.currentTokens = null;
    this._isConnected.set(false);
    this._connectedEmail.set(null);
  }

  private async clearTokens(): Promise<void> {
    await this.indexedDB.clear(DB_STORES.GOOGLE_CALENDAR_TOKENS);
    this.currentTokens = null;
  }

  // ── Calendar API Methods ──────────────────────────────────────────

  /**
   * Fetch the user's calendar list.
   */
  async getCalendarList(): Promise<GoogleCalendarEntry[]> {
    const accessToken = await this.getAccessToken();

    const response = await fetch(`${this.GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Calendar access expired. Please reconnect.');
      }
      throw new Error('Failed to fetch calendar list');
    }

    const data = await response.json();
    return (data.items || []) as GoogleCalendarEntry[];
  }

  /**
   * Fetch events from a specific calendar for a date range.
   */
  async getEvents(
    calendarId: string,
    startDate: string,
    endDate: string,
  ): Promise<GoogleCalendarEvent[]> {
    // Check cache first
    const cacheKey = `${calendarId}|${startDate}|${endDate}`;
    const cached = this.eventCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached.events;
    }

    const accessToken = await this.getAccessToken();

    const params = new URLSearchParams({
      timeMin: new Date(startDate + 'T00:00:00').toISOString(),
      timeMax: new Date(endDate + 'T23:59:59').toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const response = await fetch(
      `${this.GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Calendar access expired. Please reconnect.');
      }
      throw new Error('Failed to fetch calendar events');
    }

    const data = await response.json();
    const events = ((data.items || []) as GoogleCalendarEvent[]).filter(
      (e) => e.status !== 'cancelled',
    );

    // Cache the results
    this.eventCache.set(cacheKey, { events, fetchedAt: Date.now() });

    return events;
  }

  /**
   * Clear the event cache (e.g., on refresh).
   */
  clearEventCache(): void {
    this.eventCache.clear();
  }

  // ── PKCE Helpers ──────────────────────────────────────────────────

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  private base64UrlEncode(array: Uint8Array): string {
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async checkConnection(): Promise<boolean> {
    const tokens = await this.getStoredTokens();
    const connected = tokens !== null;
    this._isConnected.set(connected);
    this._connectedEmail.set(tokens?.accountEmail || null);
    return connected;
  }
}

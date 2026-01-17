import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, take, Observable, tap, catchError, of, map, switchMap } from 'rxjs';
import { NativeBridgeService } from './native-bridge.service';
import type { ServerInfo } from '../types/native-bridge.types';

@Injectable({
  providedIn: 'root',
})
export class PreferencesService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly nativeBridge = inject(NativeBridgeService);

  // Signals for reactive state
  readonly servers = signal<ServerInfo[]>([]);
  readonly activeServer = signal<ServerInfo | null>(null);
  readonly isValidating = signal(false);
  readonly validationError = signal<string | null>(null);

  constructor() {
    this.init();
  }

  private init(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.nativeBridge.isNativeApp()) {
      // Native app: get servers from native
      this.loadServersFromNative().subscribe();
      this.loadActiveServerFromNative().subscribe();

      // Listen for server list updates
      this.nativeBridge.onServerList().subscribe((response) => {
        this.servers.set(response.servers);
      });

      // Listen for active server updates
      this.nativeBridge.onActiveServer().subscribe((response) => {
        this.activeServer.set(response);
      });
    } else {
      // Web app: no server management needed (single server)
      const webServer: ServerInfo = {
        id: 'web',
        name: 'Web',
        url: window.location.origin,
        isCustom: false,
      };
      this.servers.set([webServer]);
      this.activeServer.set(webServer);
    }
  }

  // MARK: - Server Management

  loadServersFromNative(): Observable<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(void 0);
    }

    this.nativeBridge.getServerList();

    return this.nativeBridge.onServerList().pipe(
      take(1),
      tap((response) => this.servers.set(response.servers)),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  loadActiveServerFromNative(): Observable<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(void 0);
    }

    this.nativeBridge.getActiveServer();

    return this.nativeBridge.onActiveServer().pipe(
      take(1),
      tap((response) => this.activeServer.set(response)),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  setActiveServer(serverId: string): Observable<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(void 0);
    }

    this.nativeBridge.setActiveServer(serverId);

    return this.nativeBridge.onActiveServer().pipe(
      take(1),
      tap((response) => {
        this.activeServer.set(response);
      }),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  validateServer(url: string): Observable<boolean> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(false);
    }

    this.isValidating.set(true);
    this.validationError.set(null);

    this.nativeBridge.validateServer(url);

    return this.nativeBridge.onServerValidation().pipe(
      take(1),
      tap((response) => {
        if (!response.isValid) {
          this.validationError.set(response.error || 'Server validation failed');
        }
        this.isValidating.set(false);
      }),
      map((response) => response.isValid),
      catchError(() => {
        this.validationError.set('Failed to validate server');
        this.isValidating.set(false);
        return of(false);
      }),
    );
  }

  addServer(name: string, url: string, apiUrl?: string): Observable<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(void 0);
    }

    // Validate first, then add server if valid
    return this.validateServer(url).pipe(
      tap((isValid) => {
        if (!isValid) {
          throw new Error(this.validationError() || 'Server validation failed');
        }
        this.nativeBridge.addServer(name, url, apiUrl);
      }),
      take(1),
      tap(() => this.nativeBridge.onServerList().pipe(take(1))),
      map(() => {
        return this.nativeBridge.onServerList().pipe(
          take(1),
          tap((response) => this.servers.set(response.servers)),
          map(() => void 0),
          catchError(() => of(void 0)),
        );
      }),
      // Flatten the nested observable
      switchMap((obs: Observable<void>) => obs),
    );
  }

  removeServer(serverId: string): Observable<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return of(void 0);
    }

    this.nativeBridge.removeServer(serverId);

    return this.nativeBridge.onServerList().pipe(
      take(1),
      tap((response) => this.servers.set(response.servers)),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  // Helper to check if we're in native app
  isNativeApp(): boolean {
    return this.nativeBridge.isNativeApp();
  }
}

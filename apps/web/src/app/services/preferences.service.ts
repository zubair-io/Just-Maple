import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, take } from 'rxjs';
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

  private async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.nativeBridge.isNativeApp()) {
      // Native app: get servers from native
      await this.loadServersFromNative();
      await this.loadActiveServerFromNative();

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

  async loadServersFromNative(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return;
    }

    this.nativeBridge.getServerList();

    try {
      const response = await firstValueFrom(this.nativeBridge.onServerList().pipe(take(1)));
      this.servers.set(response.servers);
    } catch {
      console.error('[Preferences] Failed to load servers from native');
    }
  }

  async loadActiveServerFromNative(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      return;
    }

    this.nativeBridge.getActiveServer();

    try {
      const response = await firstValueFrom(this.nativeBridge.onActiveServer().pipe(take(1)));
      this.activeServer.set(response);
    } catch {
      console.error('[Preferences] Failed to load active server from native');
    }
  }

  async setActiveServer(serverId: string): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      console.warn('[Preferences] Server switching only available in native app');
      return;
    }

    this.nativeBridge.setActiveServer(serverId);

    try {
      const response = await firstValueFrom(this.nativeBridge.onActiveServer().pipe(take(1)));
      this.activeServer.set(response);

      // Native side will reload WebView to new server's root URL
      console.log('[Preferences] Switched to server:', response.name, response.url);
    } catch {
      console.error('[Preferences] Failed to set active server');
    }
  }

  async validateServer(url: string): Promise<boolean> {
    if (!this.nativeBridge.isNativeApp()) {
      console.warn('[Preferences] Server validation only available in native app');
      return false;
    }

    this.isValidating.set(true);
    this.validationError.set(null);

    this.nativeBridge.validateServer(url);

    try {
      const response = await firstValueFrom(this.nativeBridge.onServerValidation().pipe(take(1)));

      if (!response.isValid) {
        this.validationError.set(response.error || 'Server validation failed');
      }

      return response.isValid;
    } catch {
      this.validationError.set('Failed to validate server');
      return false;
    } finally {
      this.isValidating.set(false);
    }
  }

  async addServer(name: string, url: string, apiUrl?: string): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      console.warn('[Preferences] Adding servers only available in native app');
      return;
    }

    // Validate first
    const isValid = await this.validateServer(url);
    if (!isValid) {
      throw new Error(this.validationError() || 'Server validation failed');
    }

    this.nativeBridge.addServer(name, url, apiUrl);

    try {
      const response = await firstValueFrom(this.nativeBridge.onServerList().pipe(take(1)));
      this.servers.set(response.servers);
    } catch {
      console.error('[Preferences] Failed to add server');
    }
  }

  async removeServer(serverId: string): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) {
      console.warn('[Preferences] Removing servers only available in native app');
      return;
    }

    this.nativeBridge.removeServer(serverId);

    try {
      const response = await firstValueFrom(this.nativeBridge.onServerList().pipe(take(1)));
      this.servers.set(response.servers);
    } catch {
      console.error('[Preferences] Failed to remove server');
    }
  }

  // Helper to check if we're in native app
  isNativeApp(): boolean {
    return this.nativeBridge.isNativeApp();
  }
}

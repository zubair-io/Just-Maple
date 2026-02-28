import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { LocalStorageProvider } from './local-storage-provider';
import { CloudStorageProvider } from './cloud-storage-provider';
import { isLocalNotebook } from '../providers/data-provider.interface';
import type { StorageProvider, StorageProviderType } from '@maple/shared';

/**
 * Manages which StorageProvider is active based on the current route context.
 *
 * Components inject this service instead of directly depending on
 * LocalStorageProvider or CloudStorageProvider.
 *
 * Usage:
 *   readonly storage = inject(StorageContextService);
 *   const pages = await storage.activeProvider().listPages(notebookId);
 */
@Injectable({ providedIn: 'root' })
export class StorageContextService {
  private readonly router = inject(Router);
  private readonly localProvider = inject(LocalStorageProvider);
  private readonly cloudProvider = inject(CloudStorageProvider);

  /** The currently active provider type */
  private readonly _providerType = signal<StorageProviderType>('cloud');

  /** The currently active storage provider */
  readonly activeProvider = computed<StorageProvider>(() => {
    return this._providerType() === 'local' ? this.localProvider : this.cloudProvider;
  });

  /** Current provider type (reactive) */
  readonly providerType = this._providerType.asReadonly();

  /** Whether the active provider is local */
  readonly isLocal = computed(() => this._providerType() === 'local');

  /** Whether the active provider is cloud-backed */
  readonly isCloud = computed(() => this._providerType() === 'cloud');

  /**
   * Set the provider type based on route context.
   * Called by route guards or layout components when navigating.
   */
  setProviderType(type: StorageProviderType): void {
    this._providerType.set(type);
  }

  /**
   * Determine provider type from the current URL.
   * Returns 'local' if the first path segment is a local notebook ID, 'cloud' otherwise.
   */
  detectProviderFromUrl(url?: string): StorageProviderType {
    const currentUrl = url || this.router.url;
    const firstSegment = currentUrl.split('/').filter(Boolean)[0] ?? '';
    return isLocalNotebook(firstSegment) ? 'local' : 'cloud';
  }

  /**
   * Auto-detect and set provider type based on the current route.
   */
  syncFromRoute(url?: string): void {
    this._providerType.set(this.detectProviderFromUrl(url));
  }
}

import { Injectable, signal } from '@angular/core';

/**
 * Interface for cached last visited location
 */
export interface LastVisitedLocation {
  folderId: string;
  pageId?: string;
}

const STORAGE_KEY = 'sugarmaple:lastVisited';

/**
 * Service to cache the last visited folder and page location.
 * This allows users to return to where they left off when reopening the app.
 *
 * Only caches folder/page routes - navigating to settings, notifications,
 * or other routes clears the cache.
 */
@Injectable({
  providedIn: 'root',
})
export class LastVisitedService {
  private readonly _lastVisited = signal<LastVisitedLocation | null>(null);

  /** The cached last visited location */
  readonly lastVisited = this._lastVisited.asReadonly();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Save the current folder and optional page as the last visited location
   */
  save(folderId: string, pageId?: string): void {
    const location: LastVisitedLocation = { folderId };
    if (pageId) {
      location.pageId = pageId;
    }

    this._lastVisited.set(location);
    this.persistToStorage(location);
  }

  /**
   * Clear the cached last visited location.
   * Called when navigating to non-folder routes.
   */
  clear(): void {
    this._lastVisited.set(null);
    this.removeFromStorage();
  }

  /**
   * Get the last visited location
   */
  get(): LastVisitedLocation | null {
    return this._lastVisited();
  }

  /**
   * Check if there's a cached location
   */
  hasCache(): boolean {
    return this._lastVisited() !== null;
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LastVisitedLocation;
        if (parsed.folderId) {
          this._lastVisited.set(parsed);
        }
      }
    } catch {
      // Invalid stored data, ignore
      this.removeFromStorage();
    }
  }

  private persistToStorage(location: LastVisitedLocation): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    } catch {
      // Storage full or unavailable, ignore
    }
  }

  private removeFromStorage(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable, ignore
    }
  }
}

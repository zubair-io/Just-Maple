import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { StorageContextService } from './storage-context.service';
import type { FileChange } from '@maple/shared';

/**
 * Watches for external file changes (iCloud sync, other apps editing files).
 *
 * Subscribes to the active StorageProvider's watch() method.
 * Shows notifications when external changes are detected.
 */
@Injectable({ providedIn: 'root' })
export class FileWatcherService implements OnDestroy {
  private readonly storageContext = inject(StorageContextService);

  /** Recent file changes detected */
  private readonly _recentChanges = signal<FileChange[]>([]);
  readonly recentChanges = this._recentChanges.asReadonly();

  /** Whether there are unacknowledged external changes */
  private readonly _hasExternalChanges = signal(false);
  readonly hasExternalChanges = this._hasExternalChanges.asReadonly();

  private unsubscribeWatch: (() => void) | null = null;
  private currentNotebookId: string | null = null;

  /**
   * Start watching a notebook for external changes.
   * Automatically stops watching the previous notebook.
   */
  startWatching(notebookId: string): void {
    this.stopWatching();
    this.currentNotebookId = notebookId;

    const provider = this.storageContext.activeProvider();
    this.unsubscribeWatch = provider.watch(notebookId, (changes) => {
      this._recentChanges.set(changes);
      this._hasExternalChanges.set(changes.length > 0);
    });
  }

  /** Stop watching the current notebook */
  stopWatching(): void {
    if (this.unsubscribeWatch) {
      this.unsubscribeWatch();
      this.unsubscribeWatch = null;
    }
    this.currentNotebookId = null;
  }

  /** Acknowledge external changes (dismiss notification) */
  acknowledgeChanges(): void {
    this._hasExternalChanges.set(false);
    this._recentChanges.set([]);
  }

  ngOnDestroy(): void {
    this.stopWatching();
  }
}

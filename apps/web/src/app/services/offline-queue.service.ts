import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IndexedDBService } from './indexed-db.service';
import { ConnectivityService } from './connectivity.service';
import { DB_STORES } from './db-stores';
import type { OfflineQueueItem, OfflineAction } from '@maple/shared';

/**
 * Offline Queue Service
 * Queues operations when offline and processes them when back online
 * Supports create-note, update-note, delete-note, sync-notebook operations
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly connectivity = inject(ConnectivityService);

  // Queue state
  private readonly _queue = signal<OfflineQueueItem[]>([]);
  readonly queue = this._queue.asReadonly();

  private readonly _isProcessing = signal(false);
  readonly isProcessing = this._isProcessing.asReadonly();

  private readonly _lastError = signal<string | null>(null);
  readonly lastError = this._lastError.asReadonly();

  // Processing settings
  private readonly MAX_RETRIES = 5;
  private readonly BASE_RETRY_DELAY = 2000; // 2 seconds

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadQueue();
      this.setupAutoProcess();
    }
  }

  private setupAutoProcess(): void {
    // Auto-process queue when connectivity is restored
    effect(() => {
      if (this.connectivity.canSync() && this._queue().length > 0 && !this._isProcessing()) {
        this.processQueue();
      }
    });
  }

  /**
   * Load queue from IndexedDB
   */
  private async loadQueue(): Promise<void> {
    try {
      const items = await this.indexedDB.getAll<OfflineQueueItem>(DB_STORES.OFFLINE_QUEUE);
      // Sort by creation time
      items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      this._queue.set(items);
    } catch (error) {
      console.error('[OfflineQueue] Failed to load queue:', error);
    }
  }

  /**
   * Add item to queue
   */
  async enqueue(
    action: OfflineAction,
    noteId: string,
    documentId: string,
    payload?: any,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const item: OfflineQueueItem = {
      id,
      action,
      noteId,
      documentId,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: this.MAX_RETRIES,
    };

    // Persist to IndexedDB
    await this.indexedDB.put(item, DB_STORES.OFFLINE_QUEUE);

    // Update in-memory queue
    this._queue.update((q) => [...q, item]);

    console.log(`[OfflineQueue] Enqueued ${action} for ${documentId}`);

    // Try to process immediately if online
    if (this.connectivity.canSync() && !this._isProcessing()) {
      this.processQueue();
    }

    return id;
  }

  /**
   * Remove item from queue
   */
  async dequeue(id: string): Promise<void> {
    await this.indexedDB.delete(id, DB_STORES.OFFLINE_QUEUE);
    this._queue.update((q) => q.filter((item) => item.id !== id));
  }

  /**
   * Process all queued items
   */
  async processQueue(): Promise<{ success: number; failed: number }> {
    if (this._isProcessing() || !this.connectivity.canSync()) {
      return { success: 0, failed: 0 };
    }

    this._isProcessing.set(true);
    this._lastError.set(null);

    let success = 0;
    let failed = 0;

    const queue = [...this._queue()];
    console.log(`[OfflineQueue] Processing ${queue.length} items`);

    for (const item of queue) {
      try {
        const processed = await this.processItem(item);
        if (processed) {
          await this.dequeue(item.id);
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`[OfflineQueue] Error processing item ${item.id}:`, error);
        failed++;
      }
    }

    this._isProcessing.set(false);
    console.log(`[OfflineQueue] Processed: ${success} success, ${failed} failed`);

    return { success, failed };
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: OfflineQueueItem): Promise<boolean> {
    // Check if max retries exceeded
    if (item.retryCount >= item.maxRetries) {
      console.warn(`[OfflineQueue] Max retries exceeded for ${item.id}, removing`);
      return true; // Remove from queue
    }

    try {
      switch (item.action) {
        case 'create-note':
          await this.processCreateNote(item);
          break;
        case 'update-note':
          await this.processUpdateNote(item);
          break;
        case 'delete-note':
          await this.processDeleteNote(item);
          break;
        case 'sync-notebook':
          await this.processSyncNotebook(item);
          break;
        case 'move-note':
          await this.processMoveNote(item);
          break;
        case 'trash-note':
          await this.processTrashNote(item);
          break;
        case 'restore-note':
          await this.processRestoreNote(item);
          break;
        default:
          console.warn(`[OfflineQueue] Unknown action: ${item.action}`);
      }
      return true;
    } catch (error: any) {
      // Update retry count
      const updatedItem: OfflineQueueItem = {
        ...item,
        retryCount: item.retryCount + 1,
        lastError: error?.message || 'Unknown error',
        lastAttemptAt: new Date().toISOString(),
      };
      await this.indexedDB.put(updatedItem, DB_STORES.OFFLINE_QUEUE);
      this._queue.update((q) => q.map((i) => (i.id === item.id ? updatedItem : i)));

      // Schedule retry with exponential backoff
      const delay = this.BASE_RETRY_DELAY * Math.pow(2, item.retryCount);
      setTimeout(() => {
        if (this.connectivity.canSync()) {
          this.processQueue();
        }
      }, delay);

      return false;
    }
  }

  private async processCreateNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: item.documentId,
        ...item.payload,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to sync note');
    }
  }

  private async processUpdateNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notes/${item.documentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update note');
    }
  }

  private async processDeleteNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notes/${item.documentId}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete note');
    }
  }

  private async processSyncNotebook(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notebook/${item.documentId}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: item.payload.state,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to sync notebook');
    }
  }

  private async processMoveNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notes/${item.documentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId: item.payload.tagId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to move note');
    }
  }

  private async processTrashNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notes/${item.documentId}/trash`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to trash note');
    }
  }

  private async processRestoreNote(item: OfflineQueueItem): Promise<void> {
    const response = await fetch(`/api/notes/${item.documentId}/restore`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to restore note');
    }
  }

  /**
   * Get pending items count
   */
  getPendingCount(): number {
    return this._queue().length;
  }

  /**
   * Check if there are pending items for a specific note
   */
  hasPendingForNote(documentId: string): boolean {
    return this._queue().some((item) => item.documentId === documentId);
  }

  /**
   * Clear all queue items (use with caution)
   */
  async clearQueue(): Promise<void> {
    await this.indexedDB.clear(DB_STORES.OFFLINE_QUEUE);
    this._queue.set([]);
  }
}

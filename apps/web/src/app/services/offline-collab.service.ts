import { Injectable, inject, signal, effect } from '@angular/core';
import { IndexedDBService } from './indexed-db.service';
import { NetworkService } from './network.service';
import { DB_STORES } from './db-stores';

interface QueuedStep {
  noteId: string;
  step: unknown; // Step JSON
  version: number;
  timestamp: number;
}

interface QueueMetadata {
  key: string;
  queue: QueuedStep[];
}

@Injectable({ providedIn: 'root' })
export class OfflineCollabService {
  private readonly indexedDb = inject(IndexedDBService);
  private readonly network = inject(NetworkService);

  private readonly _queue = signal<QueuedStep[]>([]);
  private readonly _isFlushing = signal(false);

  readonly queue = this._queue.asReadonly();
  readonly isFlushing = this._isFlushing.asReadonly();
  readonly queueSize = signal(0);

  private flushCallbacks = new Map<string, (steps: QueuedStep[]) => Promise<void>>();

  constructor() {
    this.loadQueue();

    // Flush queue when online
    effect(() => {
      const isOnline = this.network.isOnline();
      if (isOnline && this._queue().length > 0 && !this._isFlushing()) {
        this.flushQueue();
      }
    });
  }

  /**
   * Register a callback to flush queued steps for a specific note
   */
  registerFlushCallback(noteId: string, callback: (steps: QueuedStep[]) => Promise<void>): void {
    this.flushCallbacks.set(noteId, callback);
  }

  /**
   * Unregister flush callback
   */
  unregisterFlushCallback(noteId: string): void {
    this.flushCallbacks.delete(noteId);
  }

  /**
   * Queue a step when offline or connection is unstable
   */
  async queueStep(noteId: string, step: unknown, version: number): Promise<void> {
    const queuedStep: QueuedStep = {
      noteId,
      step,
      version,
      timestamp: Date.now(),
    };

    const currentQueue = this._queue();
    this._queue.set([...currentQueue, queuedStep]);
    this.queueSize.set(this._queue().length);

    await this.saveQueue();
  }

  /**
   * Get all queued steps for a specific note
   */
  getQueuedStepsForNote(noteId: string): QueuedStep[] {
    return this._queue().filter((s) => s.noteId === noteId);
  }

  /**
   * Clear queued steps for a specific note (after successful sync)
   */
  async clearQueueForNote(noteId: string): Promise<void> {
    const filtered = this._queue().filter((s) => s.noteId !== noteId);
    this._queue.set(filtered);
    this.queueSize.set(filtered.length);
    await this.saveQueue();
  }

  /**
   * Save queue to IndexedDB
   */
  private async saveQueue(): Promise<void> {
    const metadata: QueueMetadata = {
      key: 'collab-queue',
      queue: this._queue(),
    };
    await this.indexedDb.put(metadata, DB_STORES.SYNC_METADATA);
  }

  /**
   * Load queue from IndexedDB
   */
  private async loadQueue(): Promise<void> {
    const data = await this.indexedDb.get<QueueMetadata>('collab-queue', DB_STORES.SYNC_METADATA);
    if (data?.queue) {
      this._queue.set(data.queue);
      this.queueSize.set(data.queue.length);
    }
  }

  /**
   * Flush all queued steps when back online
   */
  private async flushQueue(): Promise<void> {
    if (this._isFlushing() || this._queue().length === 0) {
      return;
    }

    this._isFlushing.set(true);

    try {
      // Group steps by noteId
      const stepsByNote = new Map<string, QueuedStep[]>();
      for (const step of this._queue()) {
        const steps = stepsByNote.get(step.noteId) || [];
        steps.push(step);
        stepsByNote.set(step.noteId, steps);
      }

      // Flush each note's steps
      for (const [noteId, steps] of stepsByNote.entries()) {
        const callback = this.flushCallbacks.get(noteId);
        if (callback) {
          try {
            await callback(steps);
            // Only clear queue after successful flush
            await this.clearQueueForNote(noteId);
            console.log(`[Offline Collab] Flushed ${steps.length} steps for note ${noteId}`);
          } catch (error) {
            console.error(`[Offline Collab] Failed to flush steps for note ${noteId}:`, error);
            // Keep queued steps for retry
          }
        } else {
          // No callback registered - remove stale steps
          await this.clearQueueForNote(noteId);
        }
      }
    } finally {
      this._isFlushing.set(false);
    }
  }

  /**
   * Get offline duration in seconds
   */
  getOfflineDurationSeconds(): number {
    if (this.network.isOnline()) {
      return 0;
    }
    const lastOnline = this.network.lastOnlineAt();
    return Math.floor((Date.now() - lastOnline.getTime()) / 1000);
  }

  /**
   * Check if offline for more than threshold (default: 1 hour)
   */
  isOfflineTooLong(thresholdSeconds: number = 3600): boolean {
    return this.getOfflineDurationSeconds() > thresholdSeconds;
  }
}

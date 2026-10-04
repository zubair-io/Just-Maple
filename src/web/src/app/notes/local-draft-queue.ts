import { computed, signal } from "@angular/core";

/** Local durable-draft outbox. Keep one in-flight snapshot and only the newest
 * pending snapshot per document. A failed write is retained for an explicit
 * retry or the next edit; neither failure nor coalescing acknowledges storage.
 * This is not a queue for canonical commands, which must never be coalesced.
 */
export class LocalDraftQueue<T> {
  private readonly pending = new Map<string, T>();
  private work?: Promise<void>;
  private readonly counts = signal({ pending: 0, writing: false });
  readonly state = this.counts.asReadonly();
  readonly busy = computed(() => this.state().writing || this.state().pending > 0);

  constructor(
    private readonly write: (draft: T) => Promise<void>,
    private readonly failed: (draft: T, error: unknown) => void,
  ) {}

  enqueue(key: string, draft: T): void {
    this.pending.set(key, draft);
    this.publish();
    this.start();
  }

  /** Wait for all accepted snapshots, including edits arriving during a write.
   * If the current attempt fails, reject; a subsequent flush retries it.
   */
  async flush(): Promise<void> {
    while (this.work || this.pending.size) {
      this.start();
      await this.work;
    }
  }

  private publish(writing = !!this.work) {
    this.counts.set({ pending: this.pending.size, writing });
  }

  private start() {
    if (this.work || !this.pending.size) return;
    // A microtask also combines multiple synchronous editor updates.
    const work = Promise.resolve().then(async () => {
      while (this.pending.size) {
        const [key, draft] = this.pending.entries().next().value!;
        this.pending.delete(key);
        this.publish(true);
        try {
          await this.write(draft);
        } catch (error) {
          // A newer edit already contains the entire current draft and receipts.
          // Keep it rather than replacing it with the failed older snapshot.
          if (!this.pending.has(key)) this.pending.set(key, draft);
          this.failed(draft, error);
          throw error;
        }
      }
    }).finally(() => {
      if (this.work === work) this.work = undefined;
      this.publish(false);
    });
    this.work = work;
    this.publish(true);
    // Background writes report through failed(); flush still observes rejection.
    void work.catch(() => undefined);
  }
}

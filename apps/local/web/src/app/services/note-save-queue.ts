/** Serial saves retain a durable recovery draft until the exact edit reaches disk. */
export class NoteSaveQueue {
  private readonly pending = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly prefix = 'just-maple-local:draft:';

  constructor(
    private readonly write: (id: string, content: string) => Promise<void>,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private readonly changed: () => void = () => {},
  ) {}

  draft(id: string): string | null {
    return this.storage.getItem(this.prefix + id);
  }
  error(id: string): string | undefined {
    return this.errors.get(id);
  }
  get hasPending(): boolean {
    return this.pending.size > 0 || this.running.size > 0;
  }

  get draftsAreDurable(): boolean {
    try {
      return [...this.pending].every(([id, content]) => this.draft(id) === content);
    } catch {
      return false;
    }
  }

  stage(id: string, content: string): void {
    this.pending.set(id, content);
    try {
      this.storage.setItem(this.prefix + id, content);
    } catch {
      this.errors.set(id, 'Recovery storage is full. Keep this note open until it saves.');
    }
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.set(
      id,
      setTimeout(() => {
        void this.flush(id).catch(() => {});
      }, 500),
    );
    this.changed();
  }

  retry(id: string): Promise<void> {
    this.blocked.delete(id);
    return this.flush(id);
  }
  suspend(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.pending.delete(id);
    this.blocked.delete(id);
    this.errors.delete(id);
    this.changed();
  }

  flush(id: string): Promise<void> {
    if (this.blocked.has(id)) return Promise.reject(new Error(this.errors.get(id)));
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const next = (this.running.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const content = this.pending.get(id);
        if (content === undefined) return;
        try {
          await this.write(id, content);
          if (this.pending.get(id) === content) {
            this.storage.removeItem(this.prefix + id);
            this.pending.delete(id);
          }
          this.errors.delete(id);
        } catch (error) {
          this.blocked.add(id);
          this.errors.set(id, error instanceof Error ? error.message : 'Could not save this note.');
          throw error;
        } finally {
          this.changed();
        }
      });
    this.running.set(id, next);
    const settled = () => {
      if (this.running.get(id) === next) this.running.delete(id);
      this.changed();
    };
    void next.then(settled, settled);
    return next;
  }

  async flushAll(): Promise<void> {
    await Promise.all(
      [...new Set([...this.pending.keys(), ...this.running.keys()])].map((id) => this.flush(id)),
    );
  }
}

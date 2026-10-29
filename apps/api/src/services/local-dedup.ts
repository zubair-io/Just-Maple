/** Per-process duplicate suppression for the single-instance SQLite deployment. */
export class LocalDedup {
    private readonly expires = new Map<string, number>();
    constructor(private readonly capacity = 10_000) {}

    accept(key: string, ttlSeconds: number, now = Date.now()): boolean {
        if ((this.expires.get(key) ?? 0) > now) return false;
        this.expires.delete(key);
        for (const [id, until] of this.expires) {
            if (until <= now) this.expires.delete(id);
        }
        while (this.expires.size >= this.capacity) {
            this.expires.delete(this.expires.keys().next().value!);
        }
        this.expires.set(key, now + ttlSeconds * 1000);
        return true;
    }
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { createInterface } from 'node:readline';

interface Work {
    message: Record<string, unknown>;
    priority: number;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeoutMs: number;
}
export class ServerSearchWorker {
    private child: ChildProcessWithoutNullStreams | null = null;
    private queue: Work[] = [];
    private socket: Socket | null = null;
    private current: (Work & { id: number; timer: ReturnType<typeof setTimeout> }) | null = null;
    private nextId = 0;
    private retryAt = 0;
    private starting: Promise<void> | null = null;
    private stopped = false;
    state: 'disabled' | 'starting' | 'ready' | 'backoff' = 'disabled';

    constructor(private readonly binary = process.env.SEARCH_WORKER_BINARY) {}

    private fail(error: Error) {
        const child = this.child;
        this.child = null;
        this.socket?.destroy();
        this.socket = null;
        this.state = 'backoff';
        this.retryAt = Date.now() + 10_000;
        if (this.current) {
            clearTimeout(this.current.timer);
            this.current.reject(error);
            this.current = null;
        }
        for (const work of this.queue.splice(0)) work.reject(error);
        child?.kill();
    }
    private async ensureReady(): Promise<void> {
        if (this.stopped || (!this.binary && !process.env.SEARCH_WORKER_SOCKET))
            throw new Error('worker_disabled');
        if (this.state === 'ready') return;
        if (this.starting) return this.starting;
        if (Date.now() < this.retryAt) throw new Error('worker_restarting');
        this.starting = (async () => {
            this.state = 'starting';
            const child = process.env.SEARCH_WORKER_SOCKET
                ? null
                : spawn(this.binary!, [], {
                      stdio: ['pipe', 'pipe', 'pipe'],
                      env: { ...process.env },
                  });
            this.child = child;
            const socket = process.env.SEARCH_WORKER_SOCKET
                ? connect({ path: process.env.SEARCH_WORKER_SOCKET })
                : null;
            this.socket = socket;
            const channel = child?.stdout ?? socket!;
            child?.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
            createInterface({ input: channel }).on('line', (line) => {
                let reply: { id: number; value?: unknown; error?: string };
                try {
                    reply = JSON.parse(line);
                } catch {
                    this.fail(new Error('worker_protocol'));
                    return;
                }
                if (!this.current || reply.id !== this.current.id) return;
                const work = this.current;
                this.current = null;
                clearTimeout(work.timer);
                if (reply.error) work.reject(new Error(reply.error));
                else work.resolve(reply.value);
                this.dispatch();
            });
            child?.on('error', () => {
                if (this.child === child) this.fail(new Error('worker_unavailable'));
            });
            child?.on('exit', () => {
                if (this.child === child) this.fail(new Error('worker_exited'));
            });
            socket?.on('error', () => {
                if (this.socket === socket) this.fail(new Error('worker_unavailable'));
            });
            socket?.on('close', () => {
                if (this.socket === socket) this.fail(new Error('worker_exited'));
            });
            const hello = await this.enqueue<{ protocol: number; dimensions: number }>(
                { op: 'ping' },
                0,
                600_000,
            );
            if (hello.protocol !== 1 || hello.dimensions !== 1024) {
                this.fail(new Error('worker_protocol_version'));
                throw new Error('worker_protocol_version');
            }
            this.state = 'ready';
        })().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }
    private enqueue<T>(
        message: Record<string, unknown>,
        priority: number,
        timeoutMs: number,
    ): Promise<T> {
        if (this.queue.length >= 32) return Promise.reject(new Error('worker_overloaded'));
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                message,
                priority,
                resolve: (value) => resolve(value as T),
                reject,
                timeoutMs,
            });
            this.queue.sort((a, b) => a.priority - b.priority);
            this.dispatch();
        });
    }
    private dispatch() {
        if (this.current || (!this.child && !this.socket)) return;
        const work = this.queue.shift();
        if (!work) return;
        const id = ++this.nextId;
        const timer = setTimeout(() => this.fail(new Error('worker_deadline')), work.timeoutMs);
        timer.unref?.();
        this.current = { ...work, id, timer };
        (this.child?.stdin ?? this.socket!).write(
            JSON.stringify({ ...work.message, id }) + '\n',
            (error) => {
                if (error) this.fail(new Error('worker_pipe'));
            },
        );
    }
    async request<T>(message: Record<string, unknown>, background = false): Promise<T> {
        await this.ensureReady();
        return this.enqueue<T>(message, background ? 10 : 1, 30_000);
    }
    start() {
        void this.ensureReady().catch(() => {});
    }
    close() {
        this.stopped = true;
        this.fail(new Error('worker_closed'));
    }
}
export const serverSearchWorker = new ServerSearchWorker();

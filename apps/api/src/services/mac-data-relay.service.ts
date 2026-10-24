import { randomUUID } from 'crypto';
import type { MacDataHostInfo } from '@maple/shared';
import { redisPubSub } from './redis.service';
import { upsertMacDataHost } from '../repositories/mac-data-host.repo';
import { findProactivePages } from '../repositories/page.repo';

/**
 * Mac Data Relay
 *
 * A user's Mac keeps iMessage, Mail and Calendar data in a local database. The Mac app
 * opens its own realtime socket and registers as that user's data host. Bots running
 * on the server ask it questions through this relay:
 *
 * 1. `request()` sends `{ type: 'request', requestId, op, params }` to the Mac.
 * 2. The Mac answers with a `result` message carrying the same requestId.
 * 3. If the Mac is connected to another API instance, the request and the reply
 *    travel over Redis (`macdata:req:{userId}`, `macdata:res:{instanceId}`).
 *
 * Requests time out after a few seconds so a sleeping Mac never stalls a bot.
 */

export interface MacDataHostSocket {
    send(data: string): void;
}

interface PendingRequest {
    userId: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface RemoteRequest {
    requestId: string;
    replyTo: string;
    op: string;
    params: Record<string, unknown>;
}

interface RemoteReply {
    requestId: string;
    result?: unknown;
    error?: string;
}

export class MacDataUnavailableError extends Error {
    constructor(
        message = "The user's Mac is offline or asleep, so its local data can't be read right now.",
    ) {
        super(message);
        this.name = 'MacDataUnavailableError';
    }
}

const INSTANCE_ID = randomUUID();
const DEFAULT_TIMEOUT_MS = 10_000;
const PRESENCE_TTL_SECONDS = 90;
const requestChannel = (userId: string) => `macdata:req:${userId}`;
const replyChannel = (instanceId: string) => `macdata:res:${instanceId}`;
const presenceKey = (userId: string) => `macdata:host:${userId}`;

export class MacDataRelayService {
    private readonly hosts = new Map<string, MacDataHostSocket>();
    /** Requests forwarded from other instances: requestId → instance waiting for the reply. */
    private readonly forwarded = new Map<string, { userId: string; replyTo: string }>();
    private readonly pending = new Map<string, PendingRequest>();
    private readonly requestHandlers = new Map<string, (message: RemoteRequest) => void>();
    private replySubscribed = false;

    // MARK: - Host lifecycle

    async register(
        userId: string,
        socket: MacDataHostSocket,
        info?: MacDataHostInfo,
    ): Promise<void> {
        this.hosts.set(userId, socket);
        await this.ensureReplyChannel();
        if (!this.requestHandlers.has(userId)) {
            const handler = (message: RemoteRequest) => this.forwardToLocalHost(userId, message);
            this.requestHandlers.set(userId, handler);
            await redisPubSub.subscribeTo(requestChannel(userId), handler).catch(() => {});
        }
        await this.heartbeat(userId, info);
        await this.pushProactiveNotebooks(userId);
    }

    async heartbeat(userId: string, info?: MacDataHostInfo): Promise<void> {
        await redisPubSub
            .setKey(presenceKey(userId), INSTANCE_ID, PRESENCE_TTL_SECONDS)
            .catch(() => {});
        if (info) await upsertMacDataHost(userId, info).catch(() => {});
    }

    async unregister(userId: string, socket: MacDataHostSocket): Promise<void> {
        if (this.hosts.get(userId) !== socket) return;
        this.hosts.delete(userId);
        const handler = this.requestHandlers.get(userId);
        if (handler) {
            this.requestHandlers.delete(userId);
            await redisPubSub.unsubscribeFrom(requestChannel(userId), handler).catch(() => {});
        }
        await redisPubSub.deleteKey(presenceKey(userId)).catch(() => {});
    }

    /** True when the user's Mac is connected to this or another API instance. */
    async isOnline(userId: string): Promise<boolean> {
        if (this.hosts.has(userId)) return true;
        return (await redisPubSub.getKey(presenceKey(userId)).catch(() => null)) !== null;
    }

    /** Tells the Mac which notebooks have a proactive bot, so it only sends batches for those. */
    async pushProactiveNotebooks(userId: string): Promise<void> {
        const pages = await findProactivePages(userId).catch(() => []);
        const notebookIds = [...new Set(pages.map((p) => p.notebookId).filter(Boolean))];
        this.sendToHost(userId, { type: 'proactive', notebookIds });
    }

    // MARK: - Requests

    async request<T>(
        userId: string,
        op: 'info' | 'search' | 'get' | 'http',
        params: Record<string, unknown>,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    ): Promise<T> {
        if (!(await this.isOnline(userId))) throw new MacDataUnavailableError();
        await this.ensureReplyChannel();
        const requestId = randomUUID();
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new MacDataUnavailableError("The user's Mac didn't answer in time."));
            }, timeoutMs);
            this.pending.set(requestId, {
                userId,
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            const local = this.sendToHost(userId, { type: 'request', requestId, op, params });
            if (!local) {
                redisPubSub.publishTo(requestChannel(userId), {
                    requestId,
                    replyTo: INSTANCE_ID,
                    op,
                    params,
                } satisfies RemoteRequest);
            }
        });
    }

    /** A `result` message from a Mac connected to this instance. */
    handleResult(userId: string, requestId: string, result: unknown, error?: string): void {
        const pending = this.pending.get(requestId);
        if (pending) {
            // A Mac may only answer requests addressed to its own user.
            if (pending.userId !== userId) return;
            this.settle(requestId, { requestId, result, error });
            return;
        }
        const forwarded = this.forwarded.get(requestId);
        if (forwarded && forwarded.userId === userId) {
            this.forwarded.delete(requestId);
            redisPubSub.publishTo(replyChannel(forwarded.replyTo), {
                requestId,
                result,
                error,
            } satisfies RemoteReply);
        }
    }

    // MARK: - Private

    private sendToHost(userId: string, event: Record<string, unknown>): boolean {
        const socket = this.hosts.get(userId);
        if (!socket) return false;
        try {
            socket.send(JSON.stringify({ channel: 'macData', event }));
            return true;
        } catch {
            this.hosts.delete(userId);
            return false;
        }
    }

    private forwardToLocalHost(userId: string, message: RemoteRequest): void {
        if (!this.hosts.has(userId)) return;
        this.forwarded.set(message.requestId, { userId, replyTo: message.replyTo });
        setTimeout(() => this.forwarded.delete(message.requestId), DEFAULT_TIMEOUT_MS * 2);
        this.sendToHost(userId, {
            type: 'request',
            requestId: message.requestId,
            op: message.op,
            params: message.params,
        });
    }

    private settle(requestId: string, reply: RemoteReply): void {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        if (reply.error) pending.reject(new Error(reply.error));
        else pending.resolve(reply.result);
    }

    private async ensureReplyChannel(): Promise<void> {
        if (this.replySubscribed) return;
        this.replySubscribed = true;
        await redisPubSub
            .subscribeTo(replyChannel(INSTANCE_ID), (reply: RemoteReply) =>
                this.settle(reply.requestId, reply),
            )
            .catch(() => {});
    }
}

export const macDataRelay = new MacDataRelayService();

/** Local AI servers can take a while to load a model and answer. */
const MAC_HTTP_TIMEOUT_MS = 170_000;

/**
 * Sends an HTTP request from the user's Mac, for AI servers on their own machine or
 * network (Ollama, LM Studio) that the API can't reach. The Mac only allows model-list
 * and chat requests to local addresses.
 */
export function macHttpSend(
    userId: string,
    timeoutMs = MAC_HTTP_TIMEOUT_MS,
): (request: {
    method: 'GET' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<{ status: number; body: string }> {
    return async (request) => {
        try {
            return await macDataRelay.request<{ status: number; body: string }>(
                userId,
                'http',
                request,
                timeoutMs,
            );
        } catch (error) {
            if (error instanceof MacDataUnavailableError)
                throw new MacDataUnavailableError(
                    "This AI server runs on its owner's Mac, which is offline or asleep. Open the Maple app on that Mac and try again.",
                );
            throw error;
        }
    };
}

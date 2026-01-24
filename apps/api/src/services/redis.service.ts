import Redis from 'ioredis';
import { config } from '../config';
import type { ChatEvent, MemoSSEEvent } from '@maple/shared';

// Channel prefixes
const CHANNELS = {
    CHAT: 'chat:', // chat:{notebookId}
    MEMO: 'memo:', // memo:{noteId} for Y.Doc sync
    APP: 'app:', // app:{userId} for app events
} as const;

type MessageHandler = (message: any) => void;

/**
 * Redis Pub/Sub Service
 * Enables cross-replica real-time messaging
 */
class RedisPubSubService {
    private publisher: Redis | null = null;
    private subscriber: Redis | null = null;
    private isConnected = false;
    private handlers = new Map<string, Set<MessageHandler>>();
    private subscribedChannels = new Set<string>();

    /**
     * Initialize Redis connections
     */
    async connect(): Promise<void> {
        if (this.isConnected) return;

        // Skip if no Redis URL configured
        if (!config.redisUrl) {
            console.log('[Redis] No REDIS_URL configured, skipping');
            return;
        }

        try {
            // Create separate connections for pub/sub (Redis requirement)
            // lazyConnect prevents immediate connection attempts
            this.publisher = new Redis(config.redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    // Stop retrying after 3 attempts
                    if (times > 3) return null;
                    return Math.min(times * 100, 3000);
                },
                lazyConnect: true,
            });

            this.subscriber = new Redis(config.redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    // Stop retrying after 3 attempts
                    if (times > 3) return null;
                    return Math.min(times * 100, 3000);
                },
                lazyConnect: true,
            });

            // Suppress error events (we handle connection errors ourselves)
            this.publisher.on('error', () => {});
            this.subscriber.on('error', () => {});

            // Connect both clients
            await Promise.all([this.publisher.connect(), this.subscriber.connect()]);

            // Handle subscriber messages
            this.subscriber.on('message', (channel, message) => {
                this.handleMessage(channel, message);
            });

            // Handle pattern messages
            this.subscriber.on('pmessage', (pattern, channel, message) => {
                this.handleMessage(channel, message);
            });

            this.isConnected = true;
            console.log('[Redis] Connected to', config.redisUrl);
        } catch (error) {
            console.error('[Redis] Failed to connect:', error);
            throw error;
        }
    }

    /**
     * Handle incoming message from Redis
     */
    private handleMessage(channel: string, message: string): void {
        try {
            const data = JSON.parse(message);
            const handlers = this.handlers.get(channel);

            if (handlers) {
                for (const handler of handlers) {
                    try {
                        handler(data);
                    } catch {
                        // Handler error
                    }
                }
            }
        } catch {
            // Parse error
        }
    }

    // ==================== Chat Pub/Sub ====================

    /**
     * Publish chat event to a tag channel
     */
    publishChat(notebookId: string, event: ChatEvent): void {
        if (!this.publisher) return;
        const channel = `${CHANNELS.CHAT}${notebookId}`;
        this.publisher.publish(channel, JSON.stringify(event));
    }

    /**
     * Subscribe to chat events for a tag
     */
    async subscribeChat(notebookId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.CHAT}${notebookId}`;
        await this.subscribe(channel, handler);
    }

    /**
     * Unsubscribe from chat events for a tag
     */
    async unsubscribeChat(notebookId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.CHAT}${notebookId}`;
        await this.unsubscribe(channel, handler);
    }

    // ==================== Memo Pub/Sub ====================

    /**
     * Publish memo event (Y.Doc update, awareness, peer events)
     */
    publishNotebook(noteId: string, event: MemoSSEEvent): void {
        if (!this.publisher) return;
        const channel = `${CHANNELS.MEMO}${noteId}`;
        this.publisher.publish(channel, JSON.stringify(event));
    }

    /**
     * Subscribe to memo events
     */
    async subscribeNotebook(noteId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.MEMO}${noteId}`;
        await this.subscribe(channel, handler);
    }

    /**
     * Unsubscribe from memo events
     */
    async unsubscribeNotebook(noteId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.MEMO}${noteId}`;
        await this.unsubscribe(channel, handler);
    }

    // ==================== App Events Pub/Sub ====================

    /**
     * Publish app event to a user channel (pages/notebooks/collectables CRUD)
     */
    publishAppEvent(userId: string, event: any): void {
        if (!this.publisher) return;
        const channel = `${CHANNELS.APP}${userId}`;
        this.publisher.publish(channel, JSON.stringify(event));
    }

    /**
     * Subscribe to app events for a user
     */
    async subscribeAppEvents(userId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.APP}${userId}`;
        await this.subscribe(channel, handler);
    }

    /**
     * Unsubscribe from app events
     */
    async unsubscribeAppEvents(userId: string, handler: MessageHandler): Promise<void> {
        const channel = `${CHANNELS.APP}${userId}`;
        await this.unsubscribe(channel, handler);
    }

    // ==================== Core Pub/Sub Methods ====================

    /**
     * Subscribe to a channel
     */
    private async subscribe(channel: string, handler: MessageHandler): Promise<void> {
        if (!this.subscriber) return;

        // Add handler to map
        if (!this.handlers.has(channel)) {
            this.handlers.set(channel, new Set());
        }
        this.handlers.get(channel)!.add(handler);

        // Subscribe to channel if not already subscribed
        if (!this.subscribedChannels.has(channel)) {
            await this.subscriber.subscribe(channel);
            this.subscribedChannels.add(channel);
        }
    }

    /**
     * Unsubscribe from a channel
     */
    private async unsubscribe(channel: string, handler: MessageHandler): Promise<void> {
        if (!this.subscriber) return;

        const handlers = this.handlers.get(channel);
        if (handlers) {
            handlers.delete(handler);

            // If no more handlers, unsubscribe from channel
            if (handlers.size === 0) {
                this.handlers.delete(channel);
                await this.subscriber.unsubscribe(channel);
                this.subscribedChannels.delete(channel);
            }
        }
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this.isConnected;
    }

    // ==================== Deduplication ====================

    /**
     * Check if a message ID was already processed, and mark it if not.
     * Uses SET NX EX for atomic check-and-set with TTL.
     * @returns true if this is a new message (should be processed), false if duplicate
     */
    async checkAndSetDedup(key: string, ttlSeconds: number = 5): Promise<boolean> {
        if (!this.publisher) return true; // No Redis, allow all
        const result = await this.publisher.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }

    /**
     * Disconnect from Redis
     */
    async disconnect(): Promise<void> {
        if (this.publisher) {
            this.publisher.disconnect();
            this.publisher = null;
        }
        if (this.subscriber) {
            this.subscriber.disconnect();
            this.subscriber = null;
        }
        this.isConnected = false;
        this.handlers.clear();
        this.subscribedChannels.clear();
    }
}

// Singleton instance
export const redisPubSub = new RedisPubSubService();

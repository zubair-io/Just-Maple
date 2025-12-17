import type { ChatEvent } from '@maple/shared';
import type { RealtimeService } from './realtime.service';
import { config } from '../config';
import { findTagByIdUnsafe } from '../repositories/tag.repo';

/**
 * SignalR implementation of RealtimeService
 * Calls AutumnBlaze Azure Functions to broadcast events via SignalR
 */
export class SignalRRealtimeService implements RealtimeService {
    private readonly baseUrl: string;

    constructor() {
        const url = config.signalrServiceUrl;
        if (!url) {
            throw new Error('SIGNALR_SERVICE_URL environment variable is required for SignalR mode');
        }
        this.baseUrl = url;
    }

    async broadcast(tagId: string, event: ChatEvent): Promise<void> {
        try {
            // Look up tag members to get recipient user IDs
            const tag = await findTagByIdUnsafe(tagId);
            if (!tag) {
                console.error(`[SignalR] Tag not found: ${tagId}`);
                return;
            }

            const recipientUserIds = tag.sharing.sharedWith.map((entry) => entry.userId);
            if (recipientUserIds.length === 0) {
                return;
            }

            const response = await fetch(`${this.baseUrl}/api/chat/broadcast`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.signalrServiceKey}`,
                },
                body: JSON.stringify({
                    event,
                    recipientUserIds,
                }),
            });

            if (!response.ok) {
                console.error(`[SignalR] Broadcast failed: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('[SignalR] Broadcast error:', error);
        }
    }

    async sendToUser(userId: string, event: ChatEvent): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/chat/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.signalrServiceKey}`,
                },
                body: JSON.stringify({
                    event,
                    userId,
                }),
            });

            if (!response.ok) {
                console.error(`[SignalR] SendToUser failed: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('[SignalR] SendToUser error:', error);
        }
    }

    async getConnectionInfo(userId: string): Promise<{ url: string; accessToken: string }> {
        const response = await fetch(`${this.baseUrl}/api/signalr/negotiate?userId=${userId}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.signalrServiceKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`SignalR negotiate failed: ${response.status}`);
        }

        return response.json();
    }
}

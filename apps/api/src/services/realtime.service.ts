import type { ChatEvent } from '@maple/shared';

// Interface for realtime service implementations
export interface RealtimeService {
    // Broadcast event to all users in a tag's chat
    broadcast(tagId: string, event: ChatEvent): Promise<void>;

    // Send event to a specific user
    sendToUser(userId: string, event: ChatEvent): Promise<void>;
}

// Singleton instance
let realtimeService: RealtimeService | null = null;

export function setRealtimeService(service: RealtimeService): void {
    realtimeService = service;
}

export function getRealtimeService(): RealtimeService {
    if (!realtimeService) {
        throw new Error('Realtime service not initialized');
    }
    return realtimeService;
}

// Helper to broadcast a chat event
export async function broadcastChatEvent(tagId: string, event: ChatEvent): Promise<void> {
    if (realtimeService) {
        await realtimeService.broadcast(tagId, event);
    }
}

import { config } from '../config';
import { findNoteByIdForCollab } from '../repositories/note.repo';
import type { CollabEvent } from '@maple/shared';

/**
 * SignalR collaboration service - handles HTTP calls to AutumnBlaze
 * for broadcasting collaboration events via SignalR
 */
export class SignalRCollabService {
    private readonly baseUrl: string;
    private readonly serviceKey: string;

    constructor() {
        const url = config.signalrServiceUrl;
        if (!url) {
            throw new Error(
                'SIGNALR_SERVICE_URL environment variable is required for SignalR mode',
            );
        }
        this.baseUrl = url;

        const key = config.signalrServiceKey;
        if (!key) {
            throw new Error(
                'SIGNALR_SERVICE_KEY environment variable is required for SignalR mode',
            );
        }
        this.serviceKey = key;
    }

    /**
     * Broadcast collaboration event to all users who have access to the note
     */
    async broadcastToNote(
        noteId: string,
        event: CollabEvent,
        excludeUserId?: string,
    ): Promise<void> {
        try {
            // Get note to determine which users should receive the update
            // NOTE: We don't exclude the sender because SignalR broadcasts to userIds,
            // not individual connections. If we exclude the user, ALL their tabs/windows
            // will miss the update. Clients filter duplicates based on clientID.
            const recipientUserIds = await this.getNoteCollaborators(noteId, undefined);

            if (recipientUserIds.length === 0) {
                return;
            }

            const response = await fetch(`${this.baseUrl}/api/collab/broadcast`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.serviceKey}`,
                },
                body: JSON.stringify({
                    event,
                    recipientUserIds,
                }),
            });

            if (!response.ok) {
                console.error(
                    `[SignalR Collab] Broadcast failed: ${response.status} ${response.statusText}`,
                );
            }
        } catch (error) {
            console.error('[SignalR Collab] Broadcast error:', error);
        }
    }

    /**
     * Get all users who should receive collaboration updates for a note
     * This includes:
     * - Note owner
     * - Users who have access to the tag (if note is in a shared tag)
     */
    private async getNoteCollaborators(noteId: string, excludeUserId?: string): Promise<string[]> {
        try {
            const note = await findNoteByIdForCollab(noteId, 'SignalRCollabService');
            if (!note) {
                console.error(`[SignalR Collab] Note not found: ${noteId}`);
                return [];
            }

            const collaborators = new Set<string>();

            // Always include note owner
            collaborators.add(note.userId);

            // If note is in a tag, include all tag members
            if (note.tagId) {
                const { findTagByIdUnsafe } = await import('../repositories/tag.repo');
                const tag = await findTagByIdUnsafe(note.tagId);
                if (tag) {
                    // Add all users who have access to the tag
                    if (tag.sharing?.sharedWith) {
                        tag.sharing.sharedWith.forEach((entry: any) => {
                            collaborators.add(entry.userId);
                        });
                    }
                }
            }

            // Remove excluded user (usually the sender)
            if (excludeUserId) {
                collaborators.delete(excludeUserId);
            }

            return Array.from(collaborators);
        } catch (error) {
            console.error('[SignalR Collab] Error getting collaborators:', error);
            return [];
        }
    }
}

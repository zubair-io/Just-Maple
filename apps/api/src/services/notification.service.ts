import type { DeviceRegistration, NotificationType } from '@maple/shared';
import * as notificationRepo from '../repositories/notification.repo';
import { countUnreadNotifications } from '../repositories/notification.repo';
import { markAsReadByPageId } from '../repositories/unread.repo';
import { findMessagesPageByNotebookId } from '../repositories/page.repo';
import { config } from '../config';
import { ApnsPushError, sendApnsPush } from './apns.service';

// Paperbark API client
interface PaperbarkPushRequest {
    serverUrl: string;
    notification: {
        title: string;
        body: string;
        badge: number;
        data: {
            notificationId: string;
            type: string;
        };
    };
}

/**
 * How this server sends push notifications, and what is missing when it can't.
 * A production server with APNs credentials sends directly; other servers relay
 * through Paperbark, which needs PAPERBARK_API_KEY.
 */
export function describePushSetup(): { method: 'direct APNs' | 'Paperbark'; missing: string[] } {
    if (config.useDirectApns) {
        return {
            method: 'direct APNs',
            missing: config.apnsKey || config.apnsKeyPath ? [] : ['APNS_KEY or APNS_KEY_PATH'],
        };
    }
    const missing: string[] = [];
    if (!config.paperbarkUrl) missing.push('PAPERBARK_URL');
    if (!config.paperbarkApiKey) missing.push('PAPERBARK_API_KEY');
    return { method: 'Paperbark', missing };
}

/**
 * Extract plain text from TipTap JSON content
 */
function extractTextFromTipTap(content: any): string {
    if (!content || typeof content !== 'object') {
        return '';
    }

    let text = '';

    function traverse(node: any) {
        if (node.type === 'text') {
            text += node.text || '';
        }
        if (node.content && Array.isArray(node.content)) {
            for (const child of node.content) {
                traverse(child);
            }
        }
    }

    traverse(content);
    return text.trim();
}

/** Relay a push through Paperbark. Throws when it isn't configured or the relay refuses. */
async function callPaperbark(
    serverUrl: string,
    notificationId: string,
    type: NotificationType,
    title: string,
    body: string,
    badge: number,
): Promise<void> {
    if (!config.paperbarkUrl || !config.paperbarkApiKey) {
        throw new Error(
            `Paperbark not configured (missing ${describePushSetup().missing.join(', ')})`,
        );
    }

    console.log(
        `[Notification] Sending push for notification ${notificationId} to serverUrl ${serverUrl}`,
    );

    const payload: PaperbarkPushRequest = {
        serverUrl,
        notification: {
            title,
            body,
            badge,
            data: {
                notificationId,
                type,
            },
        },
    };

    const response = await fetch(`${config.paperbarkUrl}/push/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.paperbarkApiKey}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Paperbark push failed (${response.status}): ${error}`);
    }
    console.log('[Notification] Push sent successfully:', notificationId);
}

/**
 * Send one push straight to Apple. A token from the other APNs environment
 * (a TestFlight build registered as sandbox, or a debug build as production)
 * is retried there and the device record corrected; a token Apple says is no
 * longer active is forgotten.
 */
async function sendDirectApns(
    device: DeviceRegistration,
    notificationId: string,
    type: NotificationType,
    title: string,
    body: string,
    data: Record<string, any>,
    badge: number,
): Promise<void> {
    const send = (production: boolean) =>
        sendApnsPush(
            device.deviceToken,
            notificationId,
            type,
            title,
            body,
            production,
            device.serverUrl,
            data,
            badge,
        );

    try {
        await send(device.production);
    } catch (error) {
        if (!(error instanceof ApnsPushError)) throw error;

        if (error.reason === 'Unregistered') {
            await notificationRepo.deleteDeviceRegistrationByToken(device.deviceToken);
            console.warn(
                `[Notification] Removed device ${device.deviceToken.substring(0, 8)}...: Apple says the app was uninstalled or push was turned off`,
            );
            throw error;
        }

        if (error.reason === 'BadDeviceToken') {
            try {
                await send(!device.production);
            } catch (retryError) {
                if (retryError instanceof ApnsPushError && retryError.reason === 'Unregistered') {
                    await notificationRepo.deleteDeviceRegistrationByToken(device.deviceToken);
                }
                throw retryError;
            }
            await notificationRepo.setDeviceRegistrationEnvironment(device._id, !device.production);
            console.log(
                `[Notification] Device ${device.deviceToken.substring(0, 8)}... belongs to the ${device.production ? 'sandbox' : 'production'} environment; updated its registration`,
            );
            return;
        }

        throw error;
    }
}

/**
 * Create a notification and send push to all registered devices
 */
export async function sendNotification(
    userId: string,
    type: NotificationType,
    data: Record<string, any>,
    customTitle?: string,
    customBody?: string,
    iconUrl?: string,
): Promise<string> {
    // Create notification in MongoDB
    const notification = await notificationRepo.createNotification(userId, type, data);
    console.log(
        `[Notification] Created notification ${notification._id} for user ${userId}, type: ${type}`,
    );

    // Get all device registrations for this user
    const devices = await notificationRepo.findDeviceRegistrationsByUserId(userId);
    console.log(`[Notification] Found ${devices.length} device registration(s) for user ${userId}`);

    if (devices.length === 0) {
        console.warn(
            `[Notification] No device registrations found for user ${userId}, skipping push`,
        );
        return notification._id;
    }

    // Get generic message for this notification type
    const fallbackMessages: Record<NotificationType, { title: string; body: string }> = {
        transcription_complete: {
            title: 'Transcription Complete',
            body: 'Your voice memo has been transcribed',
        },
        share_received: {
            title: 'New Share',
            body: 'Someone shared a memo with you',
        },
        reminder: {
            title: 'Reminder',
            body: 'You have a reminder',
        },
        processing_failed: {
            title: 'Processing Failed',
            body: 'Unable to process your memo',
        },
        export_ready: {
            title: 'Export Ready',
            body: 'Your export is ready to download',
        },
        message_received: {
            title: 'New Message',
            body: 'You have a new message',
        },
    };

    const fallback = fallbackMessages[type];
    const title = customTitle || fallback.title;
    const body = customBody || fallback.body;

    // The app icon badge is the unread notification count (includes the one just created)
    const badgeCount = await countUnreadNotifications(userId);
    console.log(`[Notification] Badge count for user ${userId}: ${badgeCount}`);

    const { method } = describePushSetup();
    // Add senderProfilePictureUrl to data if iconUrl is provided
    const payloadData = iconUrl ? { ...data, senderProfilePictureUrl: iconUrl } : data;

    const results = await Promise.allSettled(
        devices.map((device) =>
            method === 'direct APNs'
                ? sendDirectApns(
                      device,
                      notification._id,
                      type,
                      title,
                      body,
                      payloadData,
                      badgeCount,
                  )
                : callPaperbark(device.serverUrl, notification._id, type, title, body, badgeCount),
        ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failures = results.flatMap((r) =>
        r.status === 'rejected'
            ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
            : [],
    );
    console.log(
        `[Notification] Push results: ${succeeded} delivered to ${method}, ${failures.length} failed${failures.length ? ` (${[...new Set(failures)].join('; ')})` : ''}`,
    );

    return notification._id;
}

/**
 * Send transcription complete notification
 */
export async function sendTranscriptionCompleteNotification(
    userId: string,
    memoId: string,
): Promise<string> {
    return sendNotification(userId, 'transcription_complete', { memoId });
}

/**
 * Send share received notification
 */
export async function sendShareReceivedNotification(
    userId: string,
    memoId: string,
    sharedBy: string,
): Promise<string> {
    return sendNotification(userId, 'share_received', { memoId, sharedBy });
}

/**
 * Send reminder notification
 */
export async function sendReminderNotification(
    userId: string,
    memoId: string,
    reminderTime: string,
): Promise<string> {
    return sendNotification(userId, 'reminder', { memoId, reminderTime });
}

/**
 * Send processing failed notification
 */
export async function sendProcessingFailedNotification(
    userId: string,
    memoId: string,
    errorCode: string,
): Promise<string> {
    return sendNotification(userId, 'processing_failed', { memoId, errorCode });
}

/**
 * Send export ready notification
 */
export async function sendExportReadyNotification(
    userId: string,
    exportId: string,
    format: string,
): Promise<string> {
    return sendNotification(userId, 'export_ready', { exportId, format });
}

/**
 * Send message received notification
 */
export async function sendMessageReceivedNotification(
    userId: string,
    notebookId: string,
    pageId: string | undefined,
    messageId: string,
    senderEmail: string | undefined,
    senderName: string | undefined,
    senderProfilePictureUrl: string | undefined,
    messageContent: any,
): Promise<string> {
    // Extract plain text from TipTap JSON for notification body
    const messageText = extractTextFromTipTap(messageContent);
    const messagePreview = messageText.substring(0, 200); // Store up to 200 chars

    // Use sender name if available, otherwise email
    const displayName = senderName || senderEmail || 'Maple user';

    const notificationBody = messageText
        ? `${displayName}: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`
        : `${displayName} sent you a message`;

    return sendNotification(
        userId,
        'message_received',
        {
            notebookId,
            // The chat the message is in, so reading that chat clears this notification
            ...(pageId ? { pageId } : {}),
            messageId,
            senderEmail,
            senderName,
            senderProfilePictureUrl,
            messagePreview,
        },
        displayName, // Use sender name or email as title
        messagePreview || 'New message', // Use message text as body
        senderProfilePictureUrl, // Use profile picture as icon
    );
}

// ============================================
// Reading
// ============================================

/**
 * A chat has been read: move its read marker to now and clear its "new message"
 * notifications, so the chat's unread count and the app badge drop together.
 * Returns the user's remaining unread notification count (the badge).
 */
export async function markChatAsRead(
    userId: string,
    chat: { pageId: string; notebookId?: string },
): Promise<{ lastReadAt: string; unreadNotificationCount: number }> {
    const tracking = await markAsReadByPageId(userId, chat.pageId);
    await notificationRepo.markMessageNotificationsAsRead(userId, chat);
    return {
        lastReadAt: tracking.lastReadAt,
        unreadNotificationCount: await countUnreadNotifications(userId),
    };
}

/** Find the chat a "new message" notification points at. */
async function resolveChat(data: {
    pageId?: string;
    notebookId?: string;
}): Promise<{ pageId: string; notebookId?: string } | null> {
    if (data.pageId) return { pageId: data.pageId, notebookId: data.notebookId };
    if (!data.notebookId) return null;
    const page = await findMessagesPageByNotebookId(data.notebookId);
    return page ? { pageId: page.id, notebookId: data.notebookId } : null;
}

/**
 * Mark one notification as read. Reading a "new message" notification reads
 * its chat too, so the chat's other notifications and unread count clear with it.
 * Returns null when the notification isn't the user's.
 */
export async function markNotificationAsRead(
    userId: string,
    id: string,
): Promise<{ unreadNotificationCount: number } | null> {
    const notification = await notificationRepo.findNotificationById(id);
    if (!notification || notification.userId !== userId) return null;

    await notificationRepo.markNotificationAsRead(id, userId);
    if (notification.type === 'message_received') {
        const chat = await resolveChat(notification.data);
        if (chat) await markChatAsRead(userId, chat);
    }
    return { unreadNotificationCount: await countUnreadNotifications(userId) };
}

/** Mark every notification as read, and every chat they point at. */
export async function markAllNotificationsAsRead(userId: string): Promise<number> {
    const chats = await notificationRepo.findChatsWithUnreadMessageNotifications(userId);
    await Promise.all(
        chats.map(async (data) => {
            const chat = await resolveChat(data);
            if (chat) await markAsReadByPageId(userId, chat.pageId);
        }),
    );
    return notificationRepo.markAllNotificationsAsRead(userId);
}

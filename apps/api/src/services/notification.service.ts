import type { NotificationType } from '@maple/shared';
import * as notificationRepo from '../repositories/notification.repo';
import { config } from '../config';
import { sendApnsPush } from './apns.service';

// Paperbark API client
interface PaperbarkPushRequest {
    serverUrl: string;
    notification: {
        title: string;
        body: string;
        data: {
            notificationId: string;
            type: string;
        };
    };
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

async function callPaperbark(
    serverUrl: string,
    notificationId: string,
    type: NotificationType,
    title: string,
    body: string,
) {
    if (!config.paperbarkUrl || !config.paperbarkApiKey) {
        console.warn(
            `[Notification] Paperbark not configured (url: ${!!config.paperbarkUrl}, apiKey: ${!!config.paperbarkApiKey}), skipping push`,
        );
        return;
    }

    console.log(
        `[Notification] Sending push for notification ${notificationId} to serverUrl ${serverUrl}`,
    );

    const payload: PaperbarkPushRequest = {
        serverUrl,
        notification: {
            title,
            body,
            data: {
                notificationId,
                type,
            },
        },
    };

    try {
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
            console.error('[Notification] Paperbark push failed:', error);
        } else {
            console.log('[Notification] Push sent successfully:', notificationId);
        }
    } catch (error) {
        console.error('[Notification] Failed to call Paperbark:', error);
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

    // Send push to each registered device
    const results = await Promise.allSettled(
        devices.map(async (device) => {
            if (config.useDirectApns) {
                // Use direct APNs with device-specific environment (production or sandbox)
                console.log(
                    `[Notification] Using direct APNs (${device.production ? 'production' : 'sandbox'}) for device ${device.deviceToken.substring(0, 8)}...`,
                );
                return sendApnsPush(
                    device.deviceToken,
                    notification._id,
                    type,
                    title,
                    body,
                    device.production,
                    device.serverUrl, // Pass serverUrl for multi-server support
                    data, // Pass notification data as additional payload data
                );
            } else {
                // Use Paperbark relay in dev/test
                return callPaperbark(device.serverUrl, notification._id, type, title, body);
            }
        }),
    );

    // Log results
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    console.log(
        `[Notification] Push results: ${succeeded} succeeded, ${failed} failed (method: ${config.useDirectApns ? 'direct APNs' : 'Paperbark'})`,
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
    tagId: string,
    messageId: string,
    senderEmail: string,
    messageContent: any,
): Promise<string> {
    // Extract plain text from TipTap JSON for notification body
    const messageText = extractTextFromTipTap(messageContent);
    const messagePreview = messageText.substring(0, 200); // Store up to 200 chars

    const notificationBody = messageText
        ? `${senderEmail}: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`
        : `${senderEmail} sent you a message`;

    return sendNotification(
        userId,
        'message_received',
        { tagId, messageId, senderEmail, messagePreview }, // Store message preview in data
        senderEmail, // Use sender email as title
        messagePreview || 'New message', // Use message text as body
    );
}

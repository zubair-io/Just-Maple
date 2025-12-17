import type { NotificationType } from '@maple/shared';
import * as notificationRepo from '../repositories/notification.repo';
import { config } from '../config';
import { sendApnsPush } from './apns.service';

// Paperbark API client
interface PaperbarkPushRequest {
    serverKey: string;
    notification: {
        title: string;
        body: string;
        data: {
            notificationId: string;
            type: string;
        };
    };
}

async function callPaperbark(serverKey: string, notificationId: string, type: NotificationType) {
    if (!config.paperbarkUrl || !config.paperbarkApiKey) {
        console.warn(
            `[Notification] Paperbark not configured (url: ${!!config.paperbarkUrl}, apiKey: ${!!config.paperbarkApiKey}), skipping push`,
        );
        return;
    }

    console.log(
        `[Notification] Sending push for notification ${notificationId} to serverKey ${serverKey.substring(0, 8)}...`,
    );

    // Generic fallback messages (no sensitive content)
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

    const payload: PaperbarkPushRequest = {
        serverKey,
        notification: {
            title: fallback.title,
            body: fallback.body,
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

    const { title, body } = fallbackMessages[type];

    // Send push to each registered device
    const results = await Promise.allSettled(
        devices.map(async (device) => {
            if (config.useDirectApns) {
                // Use direct APNs in production
                console.log(
                    `[Notification] Using direct APNs for device ${device.deviceToken.substring(0, 8)}...`,
                );
                return sendApnsPush(device.deviceToken, notification._id, type, title, body);
            } else {
                // Use Paperbark relay in dev/test
                return callPaperbark(device.serverKey, notification._id, type);
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
): Promise<string> {
    return sendNotification(userId, 'message_received', { tagId, messageId, senderEmail });
}

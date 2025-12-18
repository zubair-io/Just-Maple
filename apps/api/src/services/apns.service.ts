import apn from '@parse/node-apn';
import { config } from '../config';
import type { NotificationType } from '@maple/shared';

let apnProvider: apn.Provider | null = null;

/**
 * Initialize APNs provider (lazy initialization)
 */
function getApnProvider(): apn.Provider {
    if (apnProvider) {
        return apnProvider;
    }

    if (!config.apnsKeyId || !config.apnsTeamId) {
        throw new Error('APNs not configured: missing APNS_KEY_ID or APNS_TEAM_ID');
    }

    // Check for key content (preferred for Azure) or key file path
    if (!config.apnsKey && !config.apnsKeyPath) {
        throw new Error('APNs not configured: missing APNS_KEY or APNS_KEY_PATH');
    }

    const options: apn.ProviderOptions = {
        token: {
            // Use key content if provided (Azure secret), otherwise use file path
            key: config.apnsKey || config.apnsKeyPath!,
            keyId: config.apnsKeyId,
            teamId: config.apnsTeamId,
        },
        production: config.apnsProduction,
    };
    console.log('[APNs] Initializing provider with options:', options);

    apnProvider = new apn.Provider(options);
    console.log(
        `[APNs] Initialized provider (production: ${config.apnsProduction}, bundle: ${config.apnsBundleId}, key source: ${config.apnsKey ? 'secret' : 'file'})`,
    );

    return apnProvider;
}

/**
 * Send push notification directly via APNs
 */
export async function sendApnsPush(
    deviceToken: string,
    notificationId: string,
    type: NotificationType,
    title: string,
    body: string,
): Promise<void> {
    try {
        const provider = getApnProvider();

        const notification = new apn.Notification({
            alert: {
                title,
                body,
            },
            topic: config.apnsBundleId,
            payload: {
                notificationId,
                type,
            },
            sound: 'default',
            badge: 1,
        });
        console.log(
            `[APNs] Sending push`,
            {
                alert: {
                    title,
                    body,
                },
                topic: config.apnsBundleId,
                payload: {
                    notificationId,
                    type,
                },
                sound: 'default',
                badge: 1,
            },
            deviceToken,
        );

        const result = await provider.send(notification, deviceToken);

        if (result.failed.length > 0) {
            const failure = result.failed[0];
            console.error(
                `[APNs] Failed to send push to ${deviceToken.substring(0, 8)}...: ${failure.response?.reason || 'unknown error'}`,
            );
            throw new Error(failure.response?.reason || 'APNs push failed');
        }

        console.log(
            `[APNs] Successfully sent push to ${deviceToken.substring(0, 8)}... for notification ${notificationId}`,
        );
    } catch (error) {
        console.error(`[APNs] Error sending push:`, error);
        throw error;
    }
}

/**
 * Cleanup APNs provider on shutdown
 */
export function shutdownApns(): void {
    if (apnProvider) {
        apnProvider.shutdown();
        apnProvider = null;
        console.log('[APNs] Provider shutdown');
    }
}

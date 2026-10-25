import apn from '@parse/node-apn';
import { config } from '../config';
import type { NotificationType } from '@maple/shared';

/** APNs rejected a push; `reason` is Apple's code, e.g. BadDeviceToken or Unregistered. */
export class ApnsPushError extends Error {
    constructor(
        readonly reason: string,
        readonly status?: number,
    ) {
        super(`APNs push failed: ${reason}`);
        this.name = 'ApnsPushError';
    }
}

let apnProviderProduction: apn.Provider | null = null;
let apnProviderSandbox: apn.Provider | null = null;

/**
 * Initialize APNs provider (lazy initialization)
 * @param production - true for production APNs, false for sandbox
 */
function getApnProvider(production: boolean): apn.Provider {
    // Check which provider is needed and if already initialized
    if (production && apnProviderProduction) {
        return apnProviderProduction;
    }
    if (!production && apnProviderSandbox) {
        return apnProviderSandbox;
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
        production,
    };

    const provider = new apn.Provider(options);
    console.log(
        `[APNs] Initialized ${production ? 'production' : 'sandbox'} provider (bundle: ${config.apnsBundleId}, key source: ${config.apnsKey ? 'secret' : 'file'})`,
    );

    // Store the provider for reuse
    if (production) {
        apnProviderProduction = provider;
    } else {
        apnProviderSandbox = provider;
    }

    return provider;
}

/**
 * Send push notification directly via APNs
 * @param deviceToken - APNs device token
 * @param notificationId - Notification ID
 * @param type - Notification type
 * @param title - Push notification title
 * @param body - Push notification body
 * @param production - true for production APNs, false for sandbox
 * @param serverUrl - Optional server URL for multi-server support
 * @param additionalData - Optional additional data to include in payload
 * @param badgeCount - Optional badge count to display on app icon
 */
export async function sendApnsPush(
    deviceToken: string,
    notificationId: string,
    type: NotificationType,
    title: string,
    body: string,
    production: boolean = false,
    serverUrl?: string,
    additionalData?: Record<string, any>,
    badgeCount?: number,
): Promise<void> {
    try {
        const provider = getApnProvider(production);

        const payload: Record<string, any> = {
            notificationId,
            type,
            ...additionalData,
        };

        // Include serverUrl if provided (for multi-server support)
        if (serverUrl) {
            payload.serverUrl = serverUrl;
        }

        const notification = new apn.Notification({
            alert: {
                title,
                body,
            },
            topic: config.apnsBundleId,
            payload,
            sound: 'default',
            badge: badgeCount ?? 1,
            mutableContent: 1, // Enable notification service extension
        });

        console.log(
            `[APNs] Sending ${production ? 'production' : 'sandbox'} push to ${deviceToken.substring(0, 8)}... for notification ${notificationId}`,
        );

        const result = await provider.send(notification, deviceToken);

        if (result.failed.length > 0) {
            const failure = result.failed[0];
            const reason = failure.response?.reason || failure.error?.message || 'unknown error';
            console.error(
                `[APNs] Failed to send ${production ? 'production' : 'sandbox'} push to ${deviceToken.substring(0, 8)}...: ${reason}`,
            );
            throw new ApnsPushError(reason, failure.status);
        }

        console.log(
            `[APNs] Successfully sent ${production ? 'production' : 'sandbox'} push to ${deviceToken.substring(0, 8)}... for notification ${notificationId}`,
        );
    } catch (error) {
        console.error(`[APNs] Error sending push:`, error);
        throw error;
    }
}

/**
 * Cleanup APNs providers on shutdown
 */
export function shutdownApns(): void {
    if (apnProviderProduction) {
        apnProviderProduction.shutdown();
        apnProviderProduction = null;
        console.log('[APNs] Production provider shutdown');
    }
    if (apnProviderSandbox) {
        apnProviderSandbox.shutdown();
        apnProviderSandbox = null;
        console.log('[APNs] Sandbox provider shutdown');
    }
}

import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Notification, NotificationType, DeviceRegistration } from '@maple/shared';

// MongoDB document interfaces
interface NotificationDocument {
    _id: ObjectId;
    userId: string;
    type: NotificationType;
    data: Record<string, any>;
    read: boolean;
    createdAt: Date;
    expiresAt?: Date;
}

interface DeviceRegistrationDocument {
    _id: ObjectId;
    userId: string;
    serverUrl: string;
    deviceToken: string;
    platform: 'ios' | 'macos';
    production: boolean;
    registeredAt: Date;
    lastUsed: Date;
}

// Collection getters
function getNotificationCollection(): Collection<NotificationDocument> {
    return getDb().collection<NotificationDocument>('notifications');
}

function getDeviceRegistrationCollection(): Collection<DeviceRegistrationDocument> {
    return getDb().collection<DeviceRegistrationDocument>('device_registrations');
}

// Mappers
function toNotificationResponse(doc: NotificationDocument): Notification {
    return {
        _id: doc._id.toString(),
        userId: doc.userId,
        type: doc.type,
        data: doc.data,
        read: doc.read,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt?.toISOString(),
    };
}

function toDeviceRegistrationResponse(doc: DeviceRegistrationDocument): DeviceRegistration {
    return {
        _id: doc._id.toString(),
        userId: doc.userId,
        serverUrl: doc.serverUrl,
        deviceToken: doc.deviceToken,
        platform: doc.platform,
        production: doc.production,
        registeredAt: doc.registeredAt.toISOString(),
        lastUsed: doc.lastUsed.toISOString(),
    };
}

// Notification operations
export async function createNotification(
    userId: string,
    type: NotificationType,
    data: Record<string, any>,
    expiresInDays = 30,
): Promise<Notification> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const doc: Omit<NotificationDocument, '_id'> = {
        userId,
        type,
        data,
        read: false,
        createdAt: now,
        expiresAt,
    };

    const result = await getNotificationCollection().insertOne(doc as NotificationDocument);

    return toNotificationResponse({
        _id: result.insertedId,
        ...doc,
    } as NotificationDocument);
}

export async function findNotificationById(id: string): Promise<Notification | null> {
    try {
        const doc = await getNotificationCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toNotificationResponse(doc) : null;
    } catch {
        return null;
    }
}

/** Notifications past their expiry date are hidden and no longer count as unread. */
function notExpired() {
    return { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] };
}

export async function findNotificationsByUserId(
    userId: string,
    limit = 50,
    skip = 0,
): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const collection = getNotificationCollection();
    const filter = { userId, ...notExpired() };

    const [notifications, total, unreadCount] = await Promise.all([
        collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        collection.countDocuments(filter),
        countUnreadNotifications(userId),
    ]);

    return {
        notifications: notifications.map(toNotificationResponse),
        total,
        unreadCount,
    };
}

export async function markNotificationAsRead(id: string, userId: string): Promise<boolean> {
    try {
        const result = await getNotificationCollection().updateOne(
            { _id: new ObjectId(id), userId },
            { $set: { read: true } },
        );
        return result.modifiedCount > 0;
    } catch {
        return false;
    }
}

export async function markAllNotificationsAsRead(userId: string): Promise<number> {
    const result = await getNotificationCollection().updateMany(
        { userId, read: false },
        { $set: { read: true } },
    );
    return result.modifiedCount;
}

export async function deleteExpiredNotifications(): Promise<number> {
    const result = await getNotificationCollection().deleteMany({
        expiresAt: { $lt: new Date() },
    });
    return result.deletedCount;
}

export async function countUnreadNotifications(userId: string): Promise<number> {
    return await getNotificationCollection().countDocuments({
        userId,
        read: false,
        ...notExpired(),
    });
}

/**
 * Mark every unread "new message" notification for one chat as read.
 * Older notifications carry only a notebookId, so those are matched by notebook.
 */
export async function markMessageNotificationsAsRead(
    userId: string,
    chat: { pageId: string; notebookId?: string },
): Promise<number> {
    const match: Record<string, unknown>[] = [{ 'data.pageId': chat.pageId }];
    if (chat.notebookId) {
        match.push({ 'data.pageId': { $exists: false }, 'data.notebookId': chat.notebookId });
    }
    const result = await getNotificationCollection().updateMany(
        { userId, type: 'message_received', read: false, $or: match },
        { $set: { read: true } },
    );
    return result.modifiedCount;
}

/** The chats that have unread "new message" notifications. */
export async function findChatsWithUnreadMessageNotifications(
    userId: string,
): Promise<{ pageId?: string; notebookId?: string }[]> {
    const docs = await getNotificationCollection()
        .find(
            { userId, type: 'message_received', read: false },
            { projection: { 'data.pageId': 1, 'data.notebookId': 1 } },
        )
        .toArray();
    const seen = new Set<string>();
    const chats: { pageId?: string; notebookId?: string }[] = [];
    for (const doc of docs) {
        const pageId = doc.data?.['pageId'] as string | undefined;
        const notebookId = doc.data?.['notebookId'] as string | undefined;
        const key = pageId ? `page:${pageId}` : `notebook:${notebookId}`;
        if ((!pageId && !notebookId) || seen.has(key)) continue;
        seen.add(key);
        chats.push({ pageId, notebookId });
    }
    return chats;
}

// Device registration operations
export async function registerDevice(
    userId: string,
    serverUrl: string,
    deviceToken: string,
    platform: 'ios' | 'macos' = 'ios',
    production: boolean = false,
): Promise<DeviceRegistration> {
    const now = new Date();

    // Check if already registered - match the unique index (userId, serverUrl, production)
    const existing = await getDeviceRegistrationCollection().findOne({
        userId,
        serverUrl,
        production,
    });

    if (existing) {
        // Update deviceToken and other fields - device token can change if user reinstalls app
        await getDeviceRegistrationCollection().updateOne(
            { _id: existing._id },
            { $set: { deviceToken, platform, lastUsed: now } },
        );

        return toDeviceRegistrationResponse({
            ...existing,
            deviceToken,
            platform,
            lastUsed: now,
        });
    }

    // Create new registration
    const doc: Omit<DeviceRegistrationDocument, '_id'> = {
        userId,
        serverUrl,
        deviceToken,
        platform,
        production,
        registeredAt: now,
        lastUsed: now,
    };

    const result = await getDeviceRegistrationCollection().insertOne(
        doc as DeviceRegistrationDocument,
    );

    return toDeviceRegistrationResponse({
        _id: result.insertedId,
        ...doc,
    } as DeviceRegistrationDocument);
}

export async function unregisterDevice(userId: string, serverUrl: string): Promise<boolean> {
    const result = await getDeviceRegistrationCollection().deleteOne({
        userId,
        serverUrl,
    });
    return result.deletedCount > 0;
}

export async function findDeviceRegistrationsByUserId(
    userId: string,
): Promise<DeviceRegistration[]> {
    const docs = await getDeviceRegistrationCollection().find({ userId }).toArray();
    return docs.map(toDeviceRegistrationResponse);
}

/** Forget a device whose push token Apple no longer accepts. */
export async function deleteDeviceRegistrationByToken(deviceToken: string): Promise<number> {
    const result = await getDeviceRegistrationCollection().deleteMany({ deviceToken });
    return result.deletedCount;
}

/** Record which APNs environment (production or sandbox) a device token belongs to. */
export async function setDeviceRegistrationEnvironment(
    id: string,
    production: boolean,
): Promise<void> {
    try {
        await getDeviceRegistrationCollection().updateOne(
            { _id: new ObjectId(id) },
            { $set: { production } },
        );
    } catch (error) {
        // The unique index (userId, serverUrl, production) may already hold the other entry.
        console.warn('[Notification] Could not update device environment:', error);
    }
}

export async function findServerUrlsByUserId(userId: string): Promise<string[]> {
    const registrations = await findDeviceRegistrationsByUserId(userId);
    return registrations.map((r) => r.serverUrl);
}

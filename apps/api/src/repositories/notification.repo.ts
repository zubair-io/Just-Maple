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

export async function findNotificationsByUserId(
    userId: string,
    limit = 50,
    skip = 0,
): Promise<{ notifications: Notification[]; total: number }> {
    const collection = getNotificationCollection();

    const [notifications, total] = await Promise.all([
        collection.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        collection.countDocuments({ userId }),
    ]);

    return {
        notifications: notifications.map(toNotificationResponse),
        total,
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

export async function deleteExpiredNotifications(): Promise<number> {
    const result = await getNotificationCollection().deleteMany({
        expiresAt: { $lt: new Date() },
    });
    return result.deletedCount;
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

    // Check if already registered
    const existing = await getDeviceRegistrationCollection().findOne({
        userId,
        serverUrl,
    });

    if (existing) {
        // Update deviceToken, production flag, and lastUsed
        await getDeviceRegistrationCollection().updateOne(
            { _id: existing._id },
            { $set: { deviceToken, production, lastUsed: now } },
        );

        return toDeviceRegistrationResponse({
            ...existing,
            deviceToken,
            production,
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

export async function findServerUrlsByUserId(userId: string): Promise<string[]> {
    const registrations = await findDeviceRegistrationsByUserId(userId);
    return registrations.map((r) => r.serverUrl);
}

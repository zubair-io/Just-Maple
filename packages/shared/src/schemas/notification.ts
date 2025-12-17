import { Type, Static } from '@sinclair/typebox';

// Notification types
export const NotificationTypeSchema = Type.Union([
    Type.Literal('transcription_complete'),
    Type.Literal('share_received'),
    Type.Literal('reminder'),
    Type.Literal('processing_failed'),
    Type.Literal('export_ready'),
]);

export type NotificationType = Static<typeof NotificationTypeSchema>;

// Notification data payloads for each type
export const TranscriptionCompleteDataSchema = Type.Object({
    memoId: Type.String(),
});

export const ShareReceivedDataSchema = Type.Object({
    memoId: Type.String(),
    sharedBy: Type.String(),
});

export const ReminderDataSchema = Type.Object({
    memoId: Type.String(),
    reminderTime: Type.String(),
});

export const ProcessingFailedDataSchema = Type.Object({
    memoId: Type.String(),
    errorCode: Type.String(),
});

export const ExportReadyDataSchema = Type.Object({
    exportId: Type.String(),
    format: Type.String(),
});

// Notification schema
export const NotificationSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    type: NotificationTypeSchema,
    data: Type.Record(Type.String(), Type.Any()),
    read: Type.Boolean(),
    createdAt: Type.String(),
    expiresAt: Type.Optional(Type.String()),
});

export type Notification = Static<typeof NotificationSchema>;

// Device registration
export const DeviceRegistrationSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    serverKey: Type.String(),
    platform: Type.Literal('ios'),
    registeredAt: Type.String(),
    lastUsed: Type.String(),
});

export type DeviceRegistration = Static<typeof DeviceRegistrationSchema>;

// API request/response types
export const RegisterDeviceRequestSchema = Type.Object({
    serverKey: Type.String(),
    platform: Type.Literal('ios'),
});

export type RegisterDeviceRequest = Static<typeof RegisterDeviceRequestSchema>;

export const NotificationListResponseSchema = Type.Object({
    notifications: Type.Array(NotificationSchema),
    total: Type.Number(),
});

export type NotificationListResponse = Static<typeof NotificationListResponseSchema>;

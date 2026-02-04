import { getDb } from '../db/client';

export type AuditAction =
    // Custom Bot Management
    | 'custom_bot.created'
    | 'custom_bot.updated'
    | 'custom_bot.deleted'
    | 'custom_bot.status_changed'
    | 'custom_bot.token_regenerated'
    | 'custom_bot.secret_regenerated'
    // Bot Authentication
    | 'bot.login'
    | 'bot.login_failed'
    | 'bot.logout'
    | 'bot.session_revoked'
    | 'bot.sessions_revoked_all'
    // Bot API Access
    | 'bot.messages_read'
    | 'bot.message_created'
    | 'bot.thread_replied'
    // Webhook Events
    | 'webhook.invoked'
    | 'webhook.failed'
    | 'webhook.timeout';

export interface AuditLogEntry {
    _id?: string;
    action: AuditAction;
    userId: string; // Bot owner
    userBotId?: string; // The custom bot involved
    resourceType?: string; // e.g., 'message', 'page', 'session'
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    success: boolean;
    errorMessage?: string;
    createdAt: Date;
}

/**
 * Log an audit event for security-relevant bot operations
 */
export async function logAuditEvent(
    entry: Omit<AuditLogEntry, '_id' | 'createdAt'>,
): Promise<void> {
    try {
        const collection = getDb().collection('audit_logs');
        await collection.insertOne({
            ...entry,
            createdAt: new Date(),
        });
    } catch (error) {
        // Log to console but don't throw - audit logging should not break the main flow
        console.error('[AuditLog] Failed to write audit log:', error);
    }
}

/**
 * Helper to create audit log entry for custom bot operations
 */
export function createBotAuditEntry(
    action: AuditAction,
    userId: string,
    userBotId: string,
    options?: {
        metadata?: Record<string, unknown>;
        ipAddress?: string;
        userAgent?: string;
        success?: boolean;
        errorMessage?: string;
    },
): Omit<AuditLogEntry, '_id' | 'createdAt'> {
    return {
        action,
        userId,
        userBotId,
        resourceType: 'custom_bot',
        resourceId: userBotId,
        metadata: options?.metadata,
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
        success: options?.success ?? true,
        errorMessage: options?.errorMessage,
    };
}

/**
 * Get audit logs for a specific bot
 */
export async function getAuditLogsForBot(
    userBotId: string,
    options?: {
        limit?: number;
        before?: Date;
        actions?: AuditAction[];
    },
): Promise<AuditLogEntry[]> {
    const collection = getDb().collection<AuditLogEntry>('audit_logs');

    const query: Record<string, unknown> = { userBotId };

    if (options?.before) {
        query.createdAt = { $lt: options.before };
    }

    if (options?.actions && options.actions.length > 0) {
        query.action = { $in: options.actions };
    }

    const logs = await collection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(options?.limit ?? 100)
        .toArray();

    return logs;
}

/**
 * Get audit logs for a user (across all their bots)
 */
export async function getAuditLogsForUser(
    userId: string,
    options?: {
        limit?: number;
        before?: Date;
        actions?: AuditAction[];
    },
): Promise<AuditLogEntry[]> {
    const collection = getDb().collection<AuditLogEntry>('audit_logs');

    const query: Record<string, unknown> = { userId };

    if (options?.before) {
        query.createdAt = { $lt: options.before };
    }

    if (options?.actions && options.actions.length > 0) {
        query.action = { $in: options.actions };
    }

    const logs = await collection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(options?.limit ?? 100)
        .toArray();

    return logs;
}

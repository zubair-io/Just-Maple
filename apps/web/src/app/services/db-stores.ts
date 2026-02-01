/**
 * IndexedDB store name constants
 * Single source of truth for all store names used across services
 */
export const DB_STORES = {
  COLLECTIBLE_REGISTRY: 'collectible-registry',
  COLLECTABLE: 'collectable',
  NOTEBOOK: 'notebook',
  PAGE: 'page',
  SYNC_METADATA: 'sync-metadata',
  MESSAGE: 'message',
  NOTIFICATION: 'notification',
  OFFLINE_QUEUE: 'offline-queue',
  // Gmail stores (local-only, never synced to server)
  GMAIL_EMAILS: 'gmail-emails',
  GMAIL_TOKENS: 'gmail-tokens',
  GMAIL_SYNC_STATE: 'gmail-sync-state',
  GMAIL_DRAFTS: 'gmail-drafts',
} as const;

export type DBStoreName = (typeof DB_STORES)[keyof typeof DB_STORES];

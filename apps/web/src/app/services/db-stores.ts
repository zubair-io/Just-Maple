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
  FS_HANDLES: 'fs-handles',
  // Gmail stores (local-only, never synced to server)
  GMAIL_EMAILS: 'gmail-emails',
  GMAIL_TOKENS: 'gmail-tokens',
  GMAIL_SYNC_STATE: 'gmail-sync-state',
  GMAIL_DRAFTS: 'gmail-drafts',
  // Google Calendar stores (local-only, never synced to server)
  GOOGLE_CALENDAR_TOKENS: 'google-calendar-tokens',
  GOOGLE_CALENDAR_EVENTS: 'google-calendar-events',
  // Local notebook bot associations (local-only, never synced to server)
  LOCAL_NOTEBOOK_BOTS: 'local-notebook-bots',
  // Local page history snapshots
  LOCAL_SNAPSHOTS: 'local-snapshots',
  // Canvas stores
  CANVAS: 'canvas',
  CANVAS_DATA: 'canvas_data',
} as const;

export type DBStoreName = (typeof DB_STORES)[keyof typeof DB_STORES];

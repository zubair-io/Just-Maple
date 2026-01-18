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
  OFFLINE_QUEUE: 'offline-queue',
} as const;

export type DBStoreName = (typeof DB_STORES)[keyof typeof DB_STORES];

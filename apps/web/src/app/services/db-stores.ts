/**
 * IndexedDB store name constants
 * Single source of truth for all store names used across services
 */
export const DB_STORES = {
  COLLECTIBLE_REGISTRY: 'collectible-registry',
  PAPER: 'paper',
  TAG: 'tag',
  NOTE: 'note',
  SYNC_METADATA: 'sync-metadata',
  MESSAGE: 'message',
  AUTOMERGE: 'automerge',
} as const;

export type DBStoreName = (typeof DB_STORES)[keyof typeof DB_STORES];

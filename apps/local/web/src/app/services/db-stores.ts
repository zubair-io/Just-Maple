/**
 * IndexedDB store name constants
 * Single source of truth for all store names used across services
 */
export const DB_STORES = {
  FOLDER: 'notebook',
  PAGE: 'page',
  FS_HANDLES: 'fs-handles',
  LOCAL_SNAPSHOTS: 'local-snapshots',
} as const;

export type DBStoreName = (typeof DB_STORES)[keyof typeof DB_STORES];

/**
 * Index cache for fast sidebar rendering without parsing every .maple.md file.
 * Stored at .maple/index.json in each folder.
 *
 * Pure data logic — no I/O. File reads happen in the storage provider.
 */

import type { FrontmatterMeta } from './frontmatter';

export interface IndexEntry {
  id: string;
  title: string;
  type: string;
  filename: string;
  modified: string;
  isFavorite?: boolean;
  todoMeta?: FrontmatterMeta['todoMeta'];
}

export interface IndexCache {
  pages: IndexEntry[];
  lastIndexed: string;
}

/**
 * Build a fresh index from a list of page entries.
 */
export function buildIndex(pages: IndexEntry[]): IndexCache {
  return {
    pages: [...pages],
    lastIndexed: new Date().toISOString(),
  };
}

/**
 * Merge changes into an existing index.
 */
export function mergeIndex(
  existing: IndexCache,
  changes: {
    added: IndexEntry[];
    updated: IndexEntry[];
    removed: string[];
  },
): IndexCache {
  const removedSet = new Set(changes.removed);
  const updatedMap = new Map(changes.updated.map((e) => [e.id, e]));

  const pages = existing.pages
    .filter((p) => !removedSet.has(p.id))
    .map((p) => updatedMap.get(p.id) ?? p);

  // Remove updated entries from the map so we don't double-add
  for (const p of pages) {
    updatedMap.delete(p.id);
  }

  // Add any updated entries that weren't in the existing list + new entries
  pages.push(...updatedMap.values(), ...changes.added);

  return {
    pages,
    lastIndexed: new Date().toISOString(),
  };
}

/**
 * Find entries that are stale (modified timestamp mismatch) or missing (file no longer exists).
 */
export function findStaleEntries(
  index: IndexCache,
  currentFiles: Map<string, { modified: string }>,
): { stale: string[]; missing: string[] } {
  const stale: string[] = [];
  const missing: string[] = [];

  for (const entry of index.pages) {
    const file = currentFiles.get(entry.filename);
    if (!file) {
      missing.push(entry.id);
    } else if (file.modified !== entry.modified) {
      stale.push(entry.id);
    }
  }

  return { stale, missing };
}

/**
 * Parse an index cache from JSON. Returns null if corrupt or unparseable.
 */
export function parseIndexCache(json: string): IndexCache | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'pages' in parsed &&
      Array.isArray((parsed as IndexCache).pages) &&
      'lastIndexed' in parsed &&
      typeof (parsed as IndexCache).lastIndexed === 'string'
    ) {
      return parsed as IndexCache;
    }
    return null;
  } catch {
    return null;
  }
}

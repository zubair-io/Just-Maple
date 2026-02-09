import { Observable } from 'rxjs';
import type {
  Notebook,
  CreateNotebookInput,
  UpdateNotebookInput,
  Page,
  CreatePageInput,
  UpdatePageInput,
} from '@maple/shared';

/**
 * Data source types for notebooks and pages.
 * - 'api': Remote server (existing HTTP backend)
 * - 'local': Local file system (folders + markdown files)
 */
export type DataSourceType = 'api' | 'local';

/**
 * Prefix for local file system notebook IDs.
 * Used to distinguish local notebooks from API-backed ones.
 */
export const LOCAL_NOTEBOOK_PREFIX = 'local-notebook-';

/**
 * Prefix for local file system page IDs.
 * Used to distinguish local pages from API-backed ones.
 */
export const LOCAL_PAGE_PREFIX = 'local-page-';

/**
 * Check if a notebook ID belongs to a local file system notebook
 */
export function isLocalNotebook(id: string): boolean {
  return id.startsWith(LOCAL_NOTEBOOK_PREFIX);
}

/**
 * Check if a page ID belongs to a local file system page
 */
export function isLocalPage(id: string): boolean {
  return id.startsWith(LOCAL_PAGE_PREFIX);
}

/**
 * Capabilities that a data provider may or may not support.
 * Used by the UI to show/hide features based on the provider.
 */
export interface ProviderCapabilities {
  /** Can create new notebooks/folders */
  canCreate: boolean;
  /** Can delete notebooks/folders */
  canDelete: boolean;
  /** Can rename notebooks/folders */
  canRename: boolean;
  /** Supports sharing */
  canShare: boolean;
  /** Supports real-time collaboration */
  canCollaborate: boolean;
  /** Supports trash/restore */
  canTrash: boolean;
  /** Supports favorites */
  canFavorite: boolean;
  /** Supports archiving */
  canArchive: boolean;
}

/**
 * Abstract interface for notebook data access.
 * Implementations handle different data sources (API, file system, etc.)
 */
export interface NotebookDataProvider {
  readonly type: DataSourceType;
  readonly capabilities: ProviderCapabilities;

  /** Load all notebooks from this source */
  loadNotebooks(): Observable<Notebook[]>;

  /** Create a new notebook */
  createNotebook(data: CreateNotebookInput): Observable<Notebook>;

  /** Update a notebook */
  updateNotebook(id: string, data: UpdateNotebookInput): Observable<Notebook>;

  /** Delete a notebook */
  deleteNotebook(id: string): Observable<void>;
}

/**
 * Abstract interface for page data access.
 * Implementations handle different data sources (API, file system, etc.)
 */
export interface PageDataProvider {
  readonly type: DataSourceType;
  readonly capabilities: ProviderCapabilities;

  /** Load pages, optionally filtered */
  loadPages(filters?: { notebookId?: string }): Observable<Page[]>;

  /** Get a single page by ID */
  getPage(pageId: string): Observable<Page>;

  /** Create a new page */
  createPage(data: CreatePageInput): Observable<Page>;

  /** Update a page */
  updatePage(id: string, data: UpdatePageInput): Observable<Page>;

  /** Delete a page permanently */
  deletePage(id: string): Observable<void>;

  /** Get raw markdown content for a page (file system only) */
  getMarkdownContent?(pageId: string): Observable<string | null>;

  /** Save raw markdown content for a page (file system only) */
  saveMarkdownContent?(pageId: string, content: string): Observable<void>;
}

/**
 * API provider capabilities - full feature set
 */
export const API_CAPABILITIES: ProviderCapabilities = {
  canCreate: true,
  canDelete: true,
  canRename: true,
  canShare: true,
  canCollaborate: true,
  canTrash: true,
  canFavorite: true,
  canArchive: true,
};

/**
 * Local file system provider capabilities - limited feature set
 */
export const LOCAL_FS_CAPABILITIES: ProviderCapabilities = {
  canCreate: true,
  canDelete: true,
  canRename: true,
  canShare: false,
  canCollaborate: false,
  canTrash: false,
  canFavorite: false,
  canArchive: false,
};

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type {
  MemoVersionListItem,
  MemoVersionsResponse,
  RestoreVersionResponse,
} from '@maple/shared';

/**
 * Full version with state (used when previewing or restoring)
 */
export interface MemoVersionFull extends MemoVersionListItem {
  state: string; // Base64-encoded Y.js state
}

/**
 * Memo Version Service
 * Handles version history API calls for memos
 */
@Injectable({ providedIn: 'root' })
export class MemoVersionService {
  private readonly http = inject(HttpClient);

  /**
   * Get version list for a memo
   */
  getVersions(noteId: string, limit: number = 20, before?: Date): Observable<MemoVersionsResponse> {
    const params: Record<string, string> = { limit: limit.toString() };
    if (before) {
      params['before'] = before.toISOString();
    }
    return this.http.get<MemoVersionsResponse>(`/api/memos/${noteId}/versions`, { params });
  }

  /**
   * Get a specific version with full state
   */
  getVersion(noteId: string, versionId: string): Observable<MemoVersionFull> {
    return this.http.get<MemoVersionFull>(`/api/memos/${noteId}/versions/${versionId}`);
  }

  /**
   * Restore a version
   */
  restoreVersion(noteId: string, versionId: string): Observable<RestoreVersionResponse> {
    return this.http.post<RestoreVersionResponse>(
      `/api/memos/${noteId}/versions/${versionId}/restore`,
      {},
    );
  }

  /**
   * Create a manual checkpoint
   */
  createCheckpoint(noteId: string, label?: string): Observable<MemoVersionListItem> {
    return this.http
      .post<{ version: MemoVersionListItem }>(`/api/memos/${noteId}/versions`, { label })
      .pipe(map((r) => r.version));
  }

  /**
   * Get version count for a memo (uses versions endpoint with limit 0)
   */
  getVersionCount(noteId: string): Observable<number> {
    return this.getVersions(noteId, 1).pipe(
      map((response) => (response.hasMore ? -1 : response.versions.length)),
    );
  }
}

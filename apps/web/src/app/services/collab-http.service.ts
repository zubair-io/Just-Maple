import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * HTTP API service for ProseMirror collaboration
 * Handles join session and step submission for SignalR/HTTP mode
 */
@Injectable({ providedIn: 'root' })
export class CollabHttpService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl || '';

  /**
   * Join a collaboration session for a note
   * Returns init data with clientID, version, and document content
   */
  joinSession(noteId: string): Observable<{
    type: 'init';
    version: number;
    doc: any;
    clientID: string;
  }> {
    return this.http.post<{
      type: 'init';
      version: number;
      doc: any;
      clientID: string;
    }>(`${this.apiUrl}/api/collab/join/${noteId}`, {});
  }

  /**
   * Send collaboration steps to the server
   * Returns either ACK, catch-up steps, or resync request
   */
  sendSteps(
    noteId: string,
    clientID: string,
    version: number,
    steps: any[],
    doc: any,
  ): Observable<
    | { success: true }
    | { resync: true }
    | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
  > {
    return this.http.post<
      | { success: true }
      | { resync: true }
      | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
    >(`${this.apiUrl}/api/collab/${noteId}/steps`, {
      clientID,
      version,
      steps,
      doc,
    });
  }

  /**
   * Async helper to join session (returns Promise)
   */
  async joinSessionAsync(noteId: string): Promise<{
    type: 'init';
    version: number;
    doc: any;
    clientID: string;
  }> {
    return lastValueFrom(this.joinSession(noteId));
  }

  /**
   * Async helper to send steps (returns Promise)
   */
  async sendStepsAsync(
    noteId: string,
    clientID: string,
    version: number,
    steps: any[],
    doc: any,
  ): Promise<
    | { success: true }
    | { resync: true }
    | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
  > {
    return lastValueFrom(this.sendSteps(noteId, clientID, version, steps, doc));
  }

  /**
   * Send a batch of queued steps to the server (for offline flush)
   * Each step in the batch has its own version
   */
  sendStepsBatch(
    noteId: string,
    clientID: string,
    stepsBatch: Array<{ version: number; steps: any[] }>,
    doc: any,
  ): Observable<
    | { success: true }
    | { resync: true }
    | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
  > {
    return this.http.post<
      | { success: true }
      | { resync: true }
      | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
    >(`${this.apiUrl}/api/collab/${noteId}/steps/batch`, {
      clientID,
      stepsBatch,
      doc,
    });
  }

  /**
   * Async helper to send batched steps (returns Promise)
   */
  async sendStepsBatchAsync(
    noteId: string,
    clientID: string,
    stepsBatch: Array<{ version: number; steps: any[] }>,
    doc: any,
  ): Promise<
    | { success: true }
    | { resync: true }
    | { type: 'steps'; version: number; steps: any[]; clientIDs: string[] }
  > {
    return lastValueFrom(this.sendStepsBatch(noteId, clientID, stepsBatch, doc));
  }
}

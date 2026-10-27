import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { DataGraph } from '@maple/shared';

/**
 * One notebook's connected-data graph (on its Graph page): its data pages' items, the
 * people, places and topics they share, and the links between them. The server only
 * returns what the notebook's pages show you.
 */
@Injectable({ providedIn: 'root' })
export class DataGraphService {
  private readonly http = inject(HttpClient);

  private readonly _graph = signal<DataGraph | null>(null);
  readonly graph = this._graph.asReadonly();
  readonly notebookId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async load(notebookId: string): Promise<void> {
    if (this.notebookId() !== notebookId) {
      this._graph.set(null);
      this.notebookId.set(notebookId);
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const reply = await firstValueFrom(
        this.http.get<{ graph: DataGraph }>(`/api/graph/${encodeURIComponent(notebookId)}`),
      );
      // A reply for a notebook that's no longer open is dropped.
      if (this.notebookId() !== notebookId) return;
      this._graph.set(reply.graph);
    } catch (err) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(message || 'Could not load the graph.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Removes a link for everyone in the notebook. It's never made again. */
  async removeLink(linkId: string): Promise<void> {
    const notebookId = this.notebookId();
    if (!notebookId) return;
    await firstValueFrom(
      this.http.delete(
        `/api/graph/${encodeURIComponent(notebookId)}/links/${encodeURIComponent(linkId)}`,
      ),
    );
    this._graph.update((graph) =>
      graph ? { ...graph, links: graph.links.filter((link) => link.id !== linkId) } : graph,
    );
  }
}

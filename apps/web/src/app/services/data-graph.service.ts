import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { dataGraphReasonWeight, type DataGraph, type DataGraphLink } from '@maple/shared';

/**
 * One notebook's connected-data graph (on its Graph page): its data pages' items, the
 * people, places, topics and happenings they share, and one line per pair holding every
 * reason the two are connected. The server only returns what the notebook's pages show you.
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

  /**
   * Removes one reason a pair is connected, for everyone in the notebook. It's never made
   * again; the line stays while it has other reasons.
   */
  async removeReason(linkId: string, reasonId: string): Promise<void> {
    const notebookId = this.notebookId();
    if (!notebookId) return;
    await firstValueFrom(
      this.http.delete(
        `/api/graph/${encodeURIComponent(notebookId)}/links/${encodeURIComponent(reasonId)}`,
      ),
    );
    this._graph.update((graph) => {
      if (!graph) return graph;
      const links: DataGraphLink[] = [];
      for (const link of graph.links) {
        if (link.id !== linkId) {
          links.push(link);
          continue;
        }
        const reasons = link.reasons.filter((reason) => reason.id !== reasonId);
        if (reasons.length === 0) continue;
        const top = reasons[0]!;
        links.push({
          ...link,
          reasons,
          weight:
            Math.round(reasons.reduce((sum, r) => sum + dataGraphReasonWeight(r), 0) * 100) / 100,
          kind: top.kind,
          confidence: top.confidence,
          evidence: top.evidence,
          madeBy: top.madeBy,
        });
      }
      return { ...graph, links };
    });
  }

  /** Removes a whole line (every reason on it) for everyone in the notebook. */
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

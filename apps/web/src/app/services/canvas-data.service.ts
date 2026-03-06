import { Injectable, inject, signal, computed } from '@angular/core';
import { JsonDocumentService } from './json-document.service';
import { firstValueFrom, take } from 'rxjs';
import type { CanvasWidget, CanvasConnector } from '@maple/shared';

interface WidgetDataEntity {
  id: string;
  data: unknown;
}

/**
 * Canvas Data Service
 * Manages per-widget data with signals. Each widget's live data is stored
 * and accessed reactively. Subscribes to real-time JSON page updates.
 */
@Injectable({ providedIn: 'root' })
export class CanvasDataService {
  private readonly jsonDocService = inject(JsonDocumentService);

  // Simple signal-based store for widget data
  private readonly _entities = signal<WidgetDataEntity[]>([]);

  /**
   * Get reactive data signal for a specific widget
   */
  getWidgetData(widgetId: string): unknown {
    const entity = this._entities().find((e) => e.id === widgetId);
    return entity?.data ?? null;
  }

  /**
   * Get reactive computed signal for a specific widget
   */
  getWidgetDataSignal(widgetId: string) {
    return computed(() => {
      const entity = this._entities().find((e) => e.id === widgetId);
      return entity?.data ?? null;
    });
  }

  /**
   * Load data for a widget from its connector
   */
  async loadWidgetData(widget: CanvasWidget, connector: CanvasConnector): Promise<void> {
    if (connector.connectorType === 'json-page') {
      const pageId = (connector.config as Record<string, unknown>)?.['pageId'] as
        | string
        | undefined;
      if (!pageId) return;

      // Use cache-aware observable: emits cached data immediately if available,
      // otherwise fetches from API first
      const data = await firstValueFrom(
        this.jsonDocService.getJsonValue$(pageId, '').pipe(take(1)),
      );
      this.upsert(widget.id, data);
    }
  }

  /**
   * Subscribe to real-time updates for a connector's data source
   */
  subscribeToUpdates(widget: CanvasWidget, connector: CanvasConnector): void {
    if (connector.connectorType === 'json-page') {
      const pageId = (connector.config as Record<string, unknown>)?.['pageId'] as
        | string
        | undefined;
      if (!pageId) return;

      this.jsonDocService.getData$(pageId).subscribe((newData) => {
        this.upsert(widget.id, newData);
      });
    }
  }

  /**
   * Clear all widget data
   */
  clear(): void {
    this._entities.set([]);
  }

  private upsert(id: string, data: unknown): void {
    this._entities.update((entities) => {
      const index = entities.findIndex((e) => e.id === id);
      if (index >= 0) {
        const updated = [...entities];
        updated[index] = { id, data };
        return updated;
      }
      return [...entities, { id, data }];
    });
  }
}

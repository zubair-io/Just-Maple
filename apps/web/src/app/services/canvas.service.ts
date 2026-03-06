import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import type { Canvas, CanvasWidget } from '@maple/shared';

const STORE_NAME = DB_STORES.CANVAS;

/**
 * Canvas Service
 * Manages canvas document lifecycle with IndexedDB hydration.
 */
@Injectable({ providedIn: 'root' })
export class CanvasService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly indexedDB = inject(IndexedDBService);

  // State
  private readonly _canvas = signal<Canvas | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _isGenerating = signal(false);

  readonly canvas = this._canvas.asReadonly();
  readonly widgets = computed(() => this._canvas()?.widgets ?? []);
  readonly isLoading = this._isLoading.asReadonly();
  readonly isGenerating = this._isGenerating.asReadonly();

  async loadCanvas(pageId: string): Promise<void> {
    this._isLoading.set(true);

    // Hydrate from IndexedDB first
    if (isPlatformBrowser(this.platformId)) {
      try {
        const cached = await this.indexedDB.get<Canvas>(pageId, STORE_NAME);
        if (cached) {
          this._canvas.set(cached);
        }
      } catch {
        // Silently fail — IndexedDB hydration is non-critical
      }
    }

    try {
      const res = await firstValueFrom(
        this.http.get<{ document: Canvas }>(`/api/canvases/${pageId}`),
      );
      this._canvas.set(res.document);

      // Persist to IndexedDB
      if (isPlatformBrowser(this.platformId)) {
        try {
          await this.indexedDB.put(res.document, STORE_NAME);
        } catch {
          // Silently fail
        }
      }
    } catch (err) {
      console.error('[Canvas] Failed to load canvas:', err);
    } finally {
      this._isLoading.set(false);
    }
  }

  async addWidget(prompt: string): Promise<CanvasWidget> {
    this._isGenerating.set(true);
    try {
      const canvas = this._canvas();
      const res = await firstValueFrom(
        this.http.post<{ widget: CanvasWidget }>(`/api/canvases/${canvas!.id}/widgets/generate`, {
          prompt,
        }),
      );
      this._canvas.update((c) => (c ? { ...c, widgets: [...c.widgets, res.widget] } : c));
      return res.widget;
    } finally {
      this._isGenerating.set(false);
    }
  }

  async removeWidget(widgetId: string): Promise<void> {
    const canvas = this._canvas();
    await firstValueFrom(this.http.delete(`/api/canvases/${canvas!.id}/widgets/${widgetId}`));
    this._canvas.update((c) =>
      c ? { ...c, widgets: c.widgets.filter((w) => w.id !== widgetId) } : c,
    );
  }

  async regenerateWidget(widgetId: string, prompt: string): Promise<CanvasWidget> {
    this._isGenerating.set(true);
    try {
      const canvas = this._canvas();
      const res = await firstValueFrom(
        this.http.put<{ widget: CanvasWidget }>(
          `/api/canvases/${canvas!.id}/widgets/${widgetId}/regenerate`,
          { prompt },
        ),
      );
      this._canvas.update((c) =>
        c
          ? {
              ...c,
              widgets: c.widgets.map((w) => (w.id === widgetId ? res.widget : w)),
            }
          : c,
      );
      return res.widget;
    } finally {
      this._isGenerating.set(false);
    }
  }

  async updateWidget(widgetId: string, update: Partial<CanvasWidget>): Promise<void> {
    const canvas = this._canvas();
    await firstValueFrom(
      this.http.put<{ widget: CanvasWidget }>(
        `/api/canvases/${canvas!.id}/widgets/${widgetId}`,
        update,
      ),
    );
    this._canvas.update((c) =>
      c
        ? {
            ...c,
            widgets: c.widgets.map((w) => (w.id === widgetId ? { ...w, ...update } : w)),
          }
        : c,
    );
  }

  clear(): void {
    this._canvas.set(null);
    this._isLoading.set(false);
    this._isGenerating.set(false);
  }
}

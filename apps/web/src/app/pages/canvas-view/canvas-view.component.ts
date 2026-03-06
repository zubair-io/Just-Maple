import { Component, computed, inject, signal, Signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CanvasService } from '../../services/canvas.service';
import { CanvasDataService } from '../../services/canvas-data.service';
import { NoteHeaderComponent } from '../../components';
import { WidgetRendererComponent } from '../../components/organisms/widget-renderer/widget-renderer.component';
import { CanvasPromptBarComponent } from '../../components/organisms/canvas-prompt-bar/canvas-prompt-bar.component';
import type { CanvasWidget, CanvasConnector } from '@maple/shared';

@Component({
  selector: 'app-canvas-view',
  standalone: true,
  imports: [CommonModule, NoteHeaderComponent, WidgetRendererComponent, CanvasPromptBarComponent],
  templateUrl: './canvas-view.component.html',
  styleUrl: './canvas-view.component.scss',
})
export class CanvasViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly canvasService = inject(CanvasService);
  readonly canvasDataService = inject(CanvasDataService);

  private routeSubscription?: Subscription;

  readonly pageId = signal<string | null>(null);
  readonly canvas = this.canvasService.canvas;
  readonly widgets = this.canvasService.widgets;
  readonly isLoading = this.canvasService.isLoading;
  readonly isGenerating = this.canvasService.isGenerating;

  constructor() {
    this.routeSubscription = this.route.params.subscribe((params) => {
      const id = params['id'];
      if (id) {
        this.pageId.set(id);
        this.canvasService.loadCanvas(id).then(() => this.loadAllWidgetData());
      }
    });
  }

  async onPromptSubmit(prompt: string): Promise<void> {
    await this.canvasService.addWidget(prompt);
    // Reload canvas to pick up newly created connectors, then load widget data
    const pageId = this.pageId();
    if (pageId) {
      await this.canvasService.loadCanvas(pageId);
      await this.loadAllWidgetData();
    }
  }

  async onWidgetDelete(widgetId: string): Promise<void> {
    await this.canvasService.removeWidget(widgetId);
  }

  async onWidgetRegenerate(widgetId: string, newPrompt: string): Promise<void> {
    await this.canvasService.regenerateWidget(widgetId, newPrompt);
  }

  private readonly widgetDataSignals = new Map<string, Signal<unknown>>();

  getWidgetData(widgetId: string): Signal<unknown> {
    let sig = this.widgetDataSignals.get(widgetId);
    if (!sig) {
      sig = this.canvasDataService.getWidgetDataSignal(widgetId);
      this.widgetDataSignals.set(widgetId, sig);
    }
    return sig;
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.widgetDataSignals.clear();
    this.canvasService.clear();
    this.canvasDataService.clear();
  }

  private async loadAllWidgetData(): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) return;

    const connectorMap = new Map<string, CanvasConnector>();
    for (const connector of canvas.connectors) {
      connectorMap.set(connector.connectorId, connector);
    }

    for (const widget of canvas.widgets) {
      if (widget.connectorId) {
        const connector = connectorMap.get(widget.connectorId);
        if (connector) {
          await this.canvasDataService.loadWidgetData(widget, connector);
          this.canvasDataService.subscribeToUpdates(widget, connector);
        }
      }
    }
  }
}

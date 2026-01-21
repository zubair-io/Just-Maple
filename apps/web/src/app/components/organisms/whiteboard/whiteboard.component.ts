import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  OnDestroy,
  ViewChild,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { WhiteboardToolType, Camera } from '@maple/shared';
import {
  WhiteboardDocumentService,
  type WhiteboardYDoc,
} from '../../../services/whiteboard-document.service';
import { CanvasComponent } from './canvas/canvas.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
import { CursorsComponent } from './collaboration/cursors.component';
import type { Tool } from './tools/tool.interface';
import { SelectTool } from './tools/select.tool';
import { PenTool } from './tools/pen.tool';
import { ShapeTool } from './tools/shape.tool';

@Component({
  selector: 'app-whiteboard',
  standalone: true,
  imports: [CommonModule, CanvasComponent, ToolbarComponent, CursorsComponent],
  templateUrl: './whiteboard.component.html',
  styleUrl: './whiteboard.component.scss',
})
export class WhiteboardComponent implements OnDestroy {
  @ViewChild(CanvasComponent) private canvasComponent?: CanvasComponent;

  private readonly whiteboardService = inject(WhiteboardDocumentService);

  // Inputs
  readonly pageId = input.required<string>();
  /** Parent memo's pageId for embedded whiteboards (used for authorization) */
  readonly parentPageId = input<string | null>(null);

  // Whiteboard document
  readonly whiteboard = signal<WhiteboardYDoc | null>(null);
  readonly isReady = signal(false);
  readonly error = signal<string | null>(null);

  // Tool state
  readonly activeToolType = signal<WhiteboardToolType>('pen');
  readonly strokeColor = signal('#000000');
  readonly strokeSize = signal(4);
  readonly zoom = signal(1);
  readonly camera = signal<Camera>({ x: 0, y: 0, zoom: 1 });
  readonly canvasSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  // Tools
  private readonly tools: Map<WhiteboardToolType, Tool> = new Map();
  readonly activeTool = computed(() => this.tools.get(this.activeToolType()) || null);

  private lastPageId: string | null = null;

  constructor() {
    // Initialize tools
    this.tools.set('select', new SelectTool());
    this.tools.set('pen', new PenTool());
    this.tools.set('rectangle', new ShapeTool('rectangle'));
    this.tools.set('ellipse', new ShapeTool('ellipse'));
    this.tools.set('line', new ShapeTool('line'));
    this.tools.set('arrow', new ShapeTool('arrow'));

    // Load document when pageId changes
    effect(() => {
      const pageId = this.pageId();
      const parentPageId = this.parentPageId();
      if (pageId && pageId !== this.lastPageId) {
        this.lastPageId = pageId;
        this.loadDocument(pageId, parentPageId);
      }
    });
  }

  private async loadDocument(pageId: string, parentPageId?: string | null): Promise<void> {
    this.isReady.set(false);
    this.error.set(null);

    try {
      const whiteboard = await this.whiteboardService.openDocument(
        pageId,
        parentPageId ?? undefined,
      );
      this.whiteboard.set(whiteboard);
      this.isReady.set(true);
    } catch (e) {
      console.error('Failed to load whiteboard:', e);
      this.error.set('Failed to load whiteboard');
    }
  }

  onToolChange(type: WhiteboardToolType): void {
    // Deactivate current tool
    const current = this.activeTool();
    if (current) {
      current.deactivate();
    }

    this.activeToolType.set(type);

    // Update awareness
    const pageId = this.pageId();
    if (pageId) {
      this.whiteboardService.updateActiveTool(pageId, type);
    }
  }

  onColorChange(color: string): void {
    this.strokeColor.set(color);
  }

  onSizeChange(size: number): void {
    this.strokeSize.set(size);
  }

  onCameraChange(newCamera: Camera): void {
    this.zoom.set(newCamera.zoom);
    this.camera.set(newCamera);

    // Update camera in service for persistence
    const pageId = this.pageId();
    if (pageId) {
      this.whiteboardService.updateCamera(pageId, newCamera);
    }
  }

  onCursorPositionChange(position: { x: number; y: number }): void {
    const pageId = this.pageId();
    if (pageId) {
      this.whiteboardService.updateCursor(pageId, position.x, position.y);
    }
  }

  onCanvasSizeChange(size: { width: number; height: number }): void {
    this.canvasSize.set(size);
  }

  onZoomIn(): void {
    this.canvasComponent?.zoomIn();
  }

  onZoomOut(): void {
    this.canvasComponent?.zoomOut();
  }

  onZoomReset(): void {
    this.canvasComponent?.zoomToFit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Don't handle if in input field
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Tool shortcuts
    switch (event.key.toLowerCase()) {
      case 'v':
        this.onToolChange('select');
        break;
      case 'p':
        this.onToolChange('pen');
        break;
      case 'l':
        this.onToolChange('line');
        break;
      case 'r':
        this.onToolChange('rectangle');
        break;
      case 'o':
        this.onToolChange('ellipse');
        break;
      case 'a':
        if (!event.ctrlKey && !event.metaKey) {
          this.onToolChange('arrow');
        }
        break;
    }

    // Zoom shortcuts
    if (event.ctrlKey || event.metaKey) {
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        this.onZoomIn();
      } else if (event.key === '-') {
        event.preventDefault();
        this.onZoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        this.onZoomReset();
      }
    }
  }

  ngOnDestroy(): void {
    const pageId = this.lastPageId;
    if (pageId) {
      this.whiteboardService.closeDocument(pageId);
    }
  }
}

import {
  Component,
  ElementRef,
  ViewChild,
  input,
  signal,
  computed,
  effect,
  inject,
  OnDestroy,
  afterNextRender,
  HostListener,
  Output,
  EventEmitter,
  WritableSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Camera, WhiteboardToolType, WhiteboardAwarenessState } from '@maple/shared';
import type { WhiteboardYDoc } from '../../../../services/whiteboard-document.service';
import { RendererService } from './renderer.service';
import type { Tool, ToolContext } from '../tools/tool.interface';
import type { CanvasPointerEvent, ToolState, CanvasPoint } from '../models/types';
import { CAMERA_CONSTRAINTS } from '../models/types';
import { AuthService } from '../../../../services/auth.service';

@Component({
  selector: 'app-whiteboard-canvas',
  standalone: true,
  imports: [CommonModule],
  providers: [RendererService],
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnDestroy {
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly renderer = inject(RendererService);
  private readonly elementRef = inject(ElementRef);
  private readonly authService = inject(AuthService);

  // Inputs
  readonly whiteboard = input.required<WhiteboardYDoc>();
  readonly pageId = input.required<string>();
  readonly activeTool = input.required<Tool | null>();
  readonly strokeColor = input<string>('#000000');
  readonly strokeSize = input<number>(4);

  // Outputs
  @Output() cameraChange = new EventEmitter<Camera>();
  @Output() cursorPositionChange = new EventEmitter<CanvasPoint>();

  // Camera state
  readonly camera = signal<Camera>({ x: 0, y: 0, zoom: 1 });

  // Selection state
  readonly selectedIds: WritableSignal<string[]> = signal([]);

  // Tool state for rendering previews
  readonly toolState: WritableSignal<ToolState> = signal({});

  // Cursor style
  readonly cursorStyle = signal('default');

  // Remote selections for collaboration
  private readonly remoteSelections = signal<Map<string, { ids: string[]; color: string }>>(
    new Map(),
  );

  // Internal state
  private isPointerDown = false;
  private isPanning = false;
  private isSpaceHeld = false;
  private lastPointerPosition = { x: 0, y: 0 };
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderRequested = false;
  private toolContext: ToolContext | null = null;
  private awarenessCleanup: (() => void) | null = null;

  // Touch gesture state
  private touchState = {
    isMultiTouch: false,
    initialDistance: 0,
    initialZoom: 1,
    lastTouchCenter: { x: 0, y: 0 },
  };

  constructor() {
    afterNextRender(() => {
      this.initCanvas();
      this.setupYDocObservers();
    });

    // Update tool context when inputs change
    effect(() => {
      const tool = this.activeTool();
      if (tool && this.toolContext) {
        tool.activate(this.toolContext);
      }
    });

    // Sync selections to awareness
    effect(() => {
      const ids = this.selectedIds();
      const wb = this.whiteboard();
      if (wb) {
        wb.awareness.setLocalStateField('selectedIds', ids);
      }
    });
  }

  private initCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.renderer.init(canvas);

    // Setup resize observer
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.renderer.resize(width, height);
        this.requestRender();
      }
    });
    this.resizeObserver.observe(this.elementRef.nativeElement);

    // Create tool context
    this.toolContext = {
      pageId: this.pageId(),
      whiteboard: this.whiteboard(),
      camera: this.camera,
      selectedIds: this.selectedIds,
      toolState: this.toolState,
      strokeColor: computed(() => this.strokeColor()),
      strokeSize: computed(() => this.strokeSize()),
      requestRender: () => this.requestRender(),
    };

    // Activate initial tool
    const tool = this.activeTool();
    if (tool) {
      tool.activate(this.toolContext);
    }

    // Initial render
    this.requestRender();
  }

  private setupYDocObservers(): void {
    const wb = this.whiteboard();

    // Observe changes to elements and layers
    wb.elements.observeDeep(() => this.requestRender());
    wb.layers.observeDeep(() => this.requestRender());
    wb.metadata.observeDeep(() => this.requestRender());

    // Observe awareness for remote selections
    const awarenessHandler = () => this.updateRemoteSelections();
    wb.awareness.on('change', awarenessHandler);

    this.awarenessCleanup = () => {
      wb.awareness.off('change', awarenessHandler);
    };

    // Initial remote selections update
    this.updateRemoteSelections();
  }

  /**
   * Update remote selections from awareness
   */
  private updateRemoteSelections(): void {
    const wb = this.whiteboard();
    const currentUserId = this.authService.user()?._id;
    const states = wb.awareness.getStates() as Map<number, WhiteboardAwarenessState>;
    const selections = new Map<string, { ids: string[]; color: string }>();

    states.forEach((state, clientId) => {
      // Skip own selections
      if (state.user?.id === currentUserId) return;

      // Skip if no selections
      if (!state.selectedIds?.length) return;

      const userId = state.user?.id ?? `client-${clientId}`;
      const color = state.user?.color ?? this.getColorForClientId(clientId);
      selections.set(userId, { ids: state.selectedIds, color });
    });

    this.remoteSelections.set(selections);
    this.requestRender();
  }

  /**
   * Get a consistent color for a client ID
   */
  private getColorForClientId(clientId: number): string {
    const colors = [
      '#F87171', // red
      '#FB923C', // orange
      '#FBBF24', // amber
      '#A3E635', // lime
      '#34D399', // emerald
      '#22D3EE', // cyan
      '#60A5FA', // blue
      '#A78BFA', // violet
      '#F472B6', // pink
    ];
    return colors[clientId % colors.length];
  }

  /**
   * Request a render on the next animation frame
   */
  requestRender(): void {
    if (this.renderRequested) return;

    this.renderRequested = true;
    this.animationFrameId = requestAnimationFrame(() => {
      this.render();
      this.renderRequested = false;
    });
  }

  /**
   * Render the canvas
   */
  private render(): void {
    const wb = this.whiteboard();
    this.renderer.render(
      wb.layers,
      wb.elements,
      this.camera(),
      this.toolState(),
      this.selectedIds(),
      this.remoteSelections(),
    );
  }

  /**
   * Handle pointer down
   */
  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.canvasRef.nativeElement.setPointerCapture(event.pointerId);

    this.isPointerDown = true;
    this.lastPointerPosition = { x: event.clientX, y: event.clientY };

    // Check for pan mode (space held or middle mouse)
    const isPan = this.isSpaceHeld || event.button === 1;

    if (isPan) {
      this.isPanning = true;
      this.cursorStyle.set('grabbing');
      return;
    }

    // Forward to active tool
    const canvasEvent = this.createCanvasPointerEvent(event);
    const tool = this.activeTool();
    if (tool) {
      const result = tool.onPointerDown(canvasEvent);
      if (result.cursor) this.cursorStyle.set(result.cursor);
      if (result.render) this.requestRender();
    }
  }

  /**
   * Handle pointer move
   */
  onPointerMove(event: PointerEvent): void {
    const canvasEvent = this.createCanvasPointerEvent(event);

    // Emit cursor position for awareness
    this.cursorPositionChange.emit(canvasEvent.canvas);

    // Handle panning
    if (this.isPanning && this.isPointerDown) {
      const dx = event.clientX - this.lastPointerPosition.x;
      const dy = event.clientY - this.lastPointerPosition.y;
      this.lastPointerPosition = { x: event.clientX, y: event.clientY };

      this.camera.update((cam) => ({
        ...cam,
        x: cam.x - dx / cam.zoom,
        y: cam.y - dy / cam.zoom,
      }));
      this.cameraChange.emit(this.camera());
      this.requestRender();
      return;
    }

    // Forward to active tool
    const tool = this.activeTool();
    if (tool) {
      const result = tool.onPointerMove(canvasEvent);
      if (result.cursor) this.cursorStyle.set(result.cursor);
      if (result.render) this.requestRender();
    }
  }

  /**
   * Handle pointer up
   */
  onPointerUp(event: PointerEvent): void {
    this.canvasRef.nativeElement.releasePointerCapture(event.pointerId);
    this.isPointerDown = false;

    if (this.isPanning) {
      this.isPanning = false;
      this.cursorStyle.set(this.isSpaceHeld ? 'grab' : 'default');
      return;
    }

    // Forward to active tool
    const canvasEvent = this.createCanvasPointerEvent(event);
    const tool = this.activeTool();
    if (tool) {
      const result = tool.onPointerUp(canvasEvent);
      if (result.cursor) this.cursorStyle.set(result.cursor);
      if (result.render) this.requestRender();
    }
  }

  /**
   * Handle pointer leave
   */
  onPointerLeave(): void {
    const tool = this.activeTool();
    if (tool?.onPointerLeave) {
      tool.onPointerLeave();
    }
  }

  /**
   * Handle wheel event for zoom
   */
  onWheel(event: WheelEvent): void {
    event.preventDefault();

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // Get mouse position relative to canvas center
    const mouseX = event.clientX - rect.left - rect.width / 2;
    const mouseY = event.clientY - rect.top - rect.height / 2;

    // Calculate zoom
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const currentZoom = this.camera().zoom;
    const newZoom = Math.max(
      CAMERA_CONSTRAINTS.minZoom,
      Math.min(CAMERA_CONSTRAINTS.maxZoom, currentZoom * zoomFactor),
    );

    if (newZoom !== currentZoom) {
      // Calculate the point in canvas space that should stay under the mouse
      const scale = newZoom / currentZoom;

      this.camera.update((cam) => ({
        x: cam.x + (mouseX * (1 - 1 / scale)) / currentZoom,
        y: cam.y + (mouseY * (1 - 1 / scale)) / currentZoom,
        zoom: newZoom,
      }));
      this.cameraChange.emit(this.camera());
      this.requestRender();
    }
  }

  /**
   * Handle keyboard events
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Space for pan mode
    if (event.code === 'Space' && !this.isSpaceHeld) {
      event.preventDefault();
      this.isSpaceHeld = true;
      if (!this.isPointerDown) {
        this.cursorStyle.set('grab');
      }
    }

    // Forward to active tool
    const tool = this.activeTool();
    if (tool?.onKeyDown?.(event)) {
      return;
    }

    // Delete selected elements
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedIds().length > 0) {
      event.preventDefault();
      this.deleteSelectedElements();
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.isSpaceHeld = false;
      if (!this.isPanning) {
        const tool = this.activeTool();
        this.cursorStyle.set(tool?.cursor || 'default');
      }
    }
  }

  /**
   * Delete selected elements
   */
  private deleteSelectedElements(): void {
    const wb = this.whiteboard();
    const ids = this.selectedIds();

    wb.ydoc.transact(() => {
      for (const id of ids) {
        // Remove from elements
        wb.elements.delete(id);

        // Remove from all layers
        for (let i = 0; i < wb.layers.length; i++) {
          const layer = wb.layers.get(i);
          const elements = layer.get('elements') as string[];
          const filtered = elements.filter((elId) => elId !== id);
          if (filtered.length !== elements.length) {
            layer.set('elements', filtered);
          }
        }
      }
    });

    this.selectedIds.set([]);
    this.requestRender();
  }

  /**
   * Create canvas pointer event from native event
   */
  private createCanvasPointerEvent(event: PointerEvent): CanvasPointerEvent {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const canvasPoint = this.renderer.screenToCanvas(
      event.clientX,
      event.clientY,
      this.camera(),
      rect,
    );

    return {
      screen: { x: event.clientX, y: event.clientY },
      canvas: canvasPoint,
      pressure: event.pressure || 0.5,
      button: event.button,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      isPan: this.isSpaceHeld || event.button === 1,
    };
  }

  /**
   * Zoom to fit content
   */
  zoomToFit(): void {
    // TODO: Calculate bounds of all elements and adjust camera
    this.camera.set({ x: 0, y: 0, zoom: 1 });
    this.cameraChange.emit(this.camera());
    this.requestRender();
  }

  /**
   * Zoom in
   */
  zoomIn(): void {
    this.camera.update((cam) => ({
      ...cam,
      zoom: Math.min(CAMERA_CONSTRAINTS.maxZoom, cam.zoom * 1.2),
    }));
    this.cameraChange.emit(this.camera());
    this.requestRender();
  }

  /**
   * Zoom out
   */
  zoomOut(): void {
    this.camera.update((cam) => ({
      ...cam,
      zoom: Math.max(CAMERA_CONSTRAINTS.minZoom, cam.zoom / 1.2),
    }));
    this.cameraChange.emit(this.camera());
    this.requestRender();
  }

  /**
   * Handle touch start for pinch zoom
   */
  onTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      event.preventDefault();
      this.touchState.isMultiTouch = true;
      this.touchState.initialDistance = this.getTouchDistance(event.touches);
      this.touchState.initialZoom = this.camera().zoom;
      this.touchState.lastTouchCenter = this.getTouchCenter(event.touches);
    }
  }

  /**
   * Handle touch move for pinch zoom and pan
   */
  onTouchMove(event: TouchEvent): void {
    if (event.touches.length === 2 && this.touchState.isMultiTouch) {
      event.preventDefault();

      // Calculate pinch zoom
      const currentDistance = this.getTouchDistance(event.touches);
      const scale = currentDistance / this.touchState.initialDistance;
      const newZoom = Math.max(
        CAMERA_CONSTRAINTS.minZoom,
        Math.min(CAMERA_CONSTRAINTS.maxZoom, this.touchState.initialZoom * scale),
      );

      // Calculate pan from center movement
      const currentCenter = this.getTouchCenter(event.touches);
      const dx = currentCenter.x - this.touchState.lastTouchCenter.x;
      const dy = currentCenter.y - this.touchState.lastTouchCenter.y;
      this.touchState.lastTouchCenter = currentCenter;

      this.camera.update((cam) => ({
        x: cam.x - dx / cam.zoom,
        y: cam.y - dy / cam.zoom,
        zoom: newZoom,
      }));

      this.cameraChange.emit(this.camera());
      this.requestRender();
    }
  }

  /**
   * Handle touch end
   */
  onTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) {
      this.touchState.isMultiTouch = false;
    }
  }

  /**
   * Get distance between two touch points
   */
  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Get center point between two touches
   */
  private getTouchCenter(touches: TouchList): { x: number; y: number } {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.awarenessCleanup) {
      this.awarenessCleanup();
    }

    const tool = this.activeTool();
    if (tool) {
      tool.deactivate();
    }

    this.renderer.destroy();
  }
}

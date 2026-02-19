// Configuration & Interfaces
export type {
    WhiteboardUserProvider,
    WhiteboardConnectivity,
    WhiteboardRealtimeTransport,
    WhiteboardOfflineQueue,
    WhiteboardVisibility,
    WhiteboardPageStore,
    WhiteboardConfig,
} from './config/interfaces';
export { provideWhiteboard } from './config/whiteboard.config';
export type { WhiteboardProviderOptions } from './config/whiteboard.config';

// Injection Tokens
export {
    WHITEBOARD_USER_PROVIDER,
    WHITEBOARD_CONNECTIVITY,
    WHITEBOARD_REALTIME_TRANSPORT,
    WHITEBOARD_OFFLINE_QUEUE,
    WHITEBOARD_VISIBILITY,
    WHITEBOARD_PAGE_STORE,
    WHITEBOARD_CONFIG,
} from './collaboration/tokens';

// Core Components
export { WhiteboardComponent } from './core/components/whiteboard/whiteboard.component';
export { CanvasComponent } from './core/components/canvas/canvas.component';
export { ToolbarComponent } from './core/components/toolbar/toolbar.component';
export { CursorsComponent } from './core/components/cursors/cursors.component';
export { RendererService } from './core/components/canvas/renderer.service';

// Tools
export type { Tool, ToolContext, ToolResult } from './core/tools/tool.interface';
export { PenTool } from './core/tools/pen.tool';
export { SelectTool } from './core/tools/select.tool';
export { ShapeTool } from './core/tools/shape.tool';

// Models
export type {
    ScreenPoint,
    CanvasPoint,
    BoundingBox,
    CanvasPointerEvent,
    PendingStroke,
    ToolState,
    StrokeOptions,
} from './core/models/types';
export {
    DEFAULT_STROKE_OPTIONS,
    COLOR_PALETTE,
    STROKE_SIZES,
    CAMERA_CONSTRAINTS,
} from './core/models/types';
export { getUserColor, getColorForClientId } from './core/models/user-colors';

// Collaboration
export { WhiteboardDocumentService } from './collaboration/whiteboard-document.service';
export type { WhiteboardYDoc } from './collaboration/whiteboard-document.service';
export { YJSWSProvider } from './collaboration/yjs-ws-provider';

import { InjectionToken } from '@angular/core';
import type {
    WhiteboardUserProvider,
    WhiteboardConnectivity,
    WhiteboardRealtimeTransport,
    WhiteboardOfflineQueue,
    WhiteboardVisibility,
    WhiteboardPageStore,
    WhiteboardConfig,
} from '../config/interfaces';

/** Current user identity for awareness and authorization. */
export const WHITEBOARD_USER_PROVIDER = new InjectionToken<WhiteboardUserProvider>(
    'WHITEBOARD_USER_PROVIDER',
);

/** Connectivity status for sync decisions. */
export const WHITEBOARD_CONNECTIVITY = new InjectionToken<WhiteboardConnectivity>(
    'WHITEBOARD_CONNECTIVITY',
);

/** WebSocket transport for Y.js sync. */
export const WHITEBOARD_REALTIME_TRANSPORT = new InjectionToken<WhiteboardRealtimeTransport>(
    'WHITEBOARD_REALTIME_TRANSPORT',
);

/** Offline queue for create/sync actions (optional). */
export const WHITEBOARD_OFFLINE_QUEUE = new InjectionToken<WhiteboardOfflineQueue>(
    'WHITEBOARD_OFFLINE_QUEUE',
);

/** Tab visibility for re-sync on focus (optional). */
export const WHITEBOARD_VISIBILITY = new InjectionToken<WhiteboardVisibility>(
    'WHITEBOARD_VISIBILITY',
);

/** Local page storage for offline-first creation (optional). */
export const WHITEBOARD_PAGE_STORE = new InjectionToken<WhiteboardPageStore>(
    'WHITEBOARD_PAGE_STORE',
);

/** Toolbar and rendering configuration (optional). */
export const WHITEBOARD_CONFIG = new InjectionToken<WhiteboardConfig>('WHITEBOARD_CONFIG');

import type { Provider } from '@angular/core';
import type {
    WhiteboardUserProvider,
    WhiteboardConnectivity,
    WhiteboardRealtimeTransport,
    WhiteboardOfflineQueue,
    WhiteboardVisibility,
    WhiteboardPageStore,
    WhiteboardConfig,
} from './interfaces';
import {
    WHITEBOARD_USER_PROVIDER,
    WHITEBOARD_CONNECTIVITY,
    WHITEBOARD_REALTIME_TRANSPORT,
    WHITEBOARD_OFFLINE_QUEUE,
    WHITEBOARD_VISIBILITY,
    WHITEBOARD_PAGE_STORE,
    WHITEBOARD_CONFIG,
} from '../collaboration/tokens';

/**
 * Options for configuring the whiteboard package providers.
 */
export interface WhiteboardProviderOptions {
    /** Required: provides current user identity. */
    userProvider: Provider;
    /** Required: reports sync availability. */
    connectivity: Provider;
    /** Required: WebSocket transport for Y.js. */
    realtimeTransport: Provider;
    /** Optional: offline queue for create/sync actions. */
    offlineQueue?: Provider;
    /** Optional: visibility change detection for re-sync. */
    visibility?: Provider;
    /** Optional: local page storage for offline-first creation. */
    pageStore?: Provider;
    /** Optional: toolbar/rendering configuration. */
    config?: WhiteboardConfig;
}

/**
 * Creates the provider array for the whiteboard package.
 *
 * @example
 * ```ts
 * // In your app's providers:
 * provideWhiteboard({
 *     userProvider: { provide: WHITEBOARD_USER_PROVIDER, useExisting: AuthService },
 *     connectivity: { provide: WHITEBOARD_CONNECTIVITY, useExisting: ConnectivityService },
 *     realtimeTransport: { provide: WHITEBOARD_REALTIME_TRANSPORT, useExisting: RealtimeWSService },
 *     offlineQueue: { provide: WHITEBOARD_OFFLINE_QUEUE, useExisting: OfflineQueueService },
 *     visibility: { provide: WHITEBOARD_VISIBILITY, useExisting: VisibilityService },
 *     pageStore: { provide: WHITEBOARD_PAGE_STORE, useExisting: PageService },
 * })
 * ```
 */
export function provideWhiteboard(options: WhiteboardProviderOptions): Provider[] {
    const providers: Provider[] = [
        options.userProvider,
        options.connectivity,
        options.realtimeTransport,
    ];

    if (options.offlineQueue) {
        providers.push(options.offlineQueue);
    }

    if (options.visibility) {
        providers.push(options.visibility);
    }

    if (options.pageStore) {
        providers.push(options.pageStore);
    }

    if (options.config) {
        providers.push({ provide: WHITEBOARD_CONFIG, useValue: options.config });
    }

    return providers;
}

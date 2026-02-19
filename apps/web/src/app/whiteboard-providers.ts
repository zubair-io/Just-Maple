import type { Provider } from '@angular/core';
import {
  WHITEBOARD_USER_PROVIDER,
  WHITEBOARD_CONNECTIVITY,
  WHITEBOARD_REALTIME_TRANSPORT,
  WHITEBOARD_OFFLINE_QUEUE,
  WHITEBOARD_VISIBILITY,
  WHITEBOARD_PAGE_STORE,
} from '@maple/whiteboard';
import { AuthService } from './services/auth.service';
import { ConnectivityService } from './services/connectivity.service';
import { RealtimeWSService } from './services/realtime-ws.service';
import { OfflineQueueService } from './services/offline-queue.service';
import { VisibilityService } from './services/visibility.service';
import { PageService } from './services/page.service';

/**
 * Provides the @maple/whiteboard injection tokens
 * using the existing app services via `useExisting`.
 */
export const whiteboardProviders: Provider[] = [
  { provide: WHITEBOARD_USER_PROVIDER, useExisting: AuthService },
  { provide: WHITEBOARD_CONNECTIVITY, useExisting: ConnectivityService },
  { provide: WHITEBOARD_REALTIME_TRANSPORT, useExisting: RealtimeWSService },
  { provide: WHITEBOARD_OFFLINE_QUEUE, useExisting: OfflineQueueService },
  { provide: WHITEBOARD_VISIBILITY, useExisting: VisibilityService },
  { provide: WHITEBOARD_PAGE_STORE, useExisting: PageService },
];

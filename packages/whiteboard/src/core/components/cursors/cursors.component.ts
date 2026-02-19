import {
    Component,
    computed,
    effect,
    inject,
    input,
    signal,
    OnDestroy,
    ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Awareness } from 'y-protocols/awareness';
import type { WhiteboardAwarenessState, WhiteboardToolType } from '@maple/shared';
import { WHITEBOARD_USER_PROVIDER } from '../../../collaboration/tokens';
import { getColorForClientId } from '../../models/user-colors';
import type { Camera } from '@maple/shared';

interface RemoteCursor {
    odlClientId: number;
    odlUserId: string;
    odlUserName: string;
    odlUserColor: string;
    odlX: number;
    odlY: number;
    odlTool: WhiteboardToolType;
    odlSelectedIds: string[];
}

@Component({
    selector: 'app-whiteboard-cursors',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './cursors.component.html',
    styleUrl: './cursors.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CursorsComponent implements OnDestroy {
    private readonly userProvider = inject(WHITEBOARD_USER_PROVIDER);

    readonly awareness = input.required<Awareness>();
    readonly camera = input.required<Camera>();
    readonly canvasSize = input<{ width: number; height: number }>({ width: 0, height: 0 });

    readonly remoteCursors = signal<RemoteCursor[]>([]);

    private cleanupFn: (() => void) | null = null;

    constructor() {
        effect(() => {
            const awareness = this.awareness();
            if (!awareness) return;

            // Clean up previous listener
            this.cleanup();

            // Subscribe to awareness changes
            const handler = () => this.updateRemoteCursors();
            awareness.on('change', handler);

            this.cleanupFn = () => {
                awareness.off('change', handler);
            };

            // Initial update
            this.updateRemoteCursors();
        });
    }

    ngOnDestroy(): void {
        this.cleanup();
    }

    private cleanup(): void {
        if (this.cleanupFn) {
            this.cleanupFn();
            this.cleanupFn = null;
        }
    }

    private updateRemoteCursors(): void {
        const awareness = this.awareness();
        if (!awareness) return;

        const currentUserId = this.userProvider.user()?._id;
        const localClientId = awareness.clientID;
        const states = awareness.getStates() as Map<number, WhiteboardAwarenessState>;
        const cursors: RemoteCursor[] = [];

        states.forEach((state, clientId) => {
            // Skip own cursor by clientId
            if (clientId === localClientId) {
                return;
            }

            // Skip if no cursor position
            if (!state.cursor) {
                return;
            }

            cursors.push({
                odlClientId: clientId,
                odlUserId: state.user?.id ?? '',
                odlUserName: state.user?.name ?? 'Anonymous',
                odlUserColor: state.user?.color ?? getColorForClientId(clientId),
                odlX: state.cursor.x,
                odlY: state.cursor.y,
                odlTool: state.activeTool ?? 'select',
                odlSelectedIds: state.selectedIds ?? [],
            });
        });

        this.remoteCursors.set(cursors);
    }

    /**
     * Transform canvas coordinates to screen coordinates
     */
    getScreenPosition(cursor: RemoteCursor): { x: number; y: number } {
        const cam = this.camera();
        const size = this.canvasSize();
        const halfW = size.width / 2;
        const halfH = size.height / 2;

        return {
            x: (cursor.odlX - cam.x - halfW) * cam.zoom + halfW,
            y: (cursor.odlY - cam.y - halfH) * cam.zoom + halfH,
        };
    }

    /**
     * Get cursor icon based on tool
     */
    getCursorIcon(tool: WhiteboardToolType): string {
        switch (tool) {
            case 'pen':
                return 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
            case 'rectangle':
            case 'ellipse':
            case 'line':
            case 'arrow':
                return 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
            case 'eraser':
                return 'M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.78-.78 2.05 0 2.83l3.85 3.85c.78.78 2.05.78 2.83 0L20.41 10.27c.78-.78.78-2.05 0-2.83l-3.85-3.85c-.39-.39-.9-.59-1.42-.59z';
            case 'text':
                return 'M5 4v3h5.5v12h3V7H19V4H5z';
            default:
                return 'M3 3h18v18H3V3zm16 16V5H5v14h14z';
        }
    }

    trackByCursor(_: number, cursor: RemoteCursor): number {
        return cursor.odlClientId;
    }
}

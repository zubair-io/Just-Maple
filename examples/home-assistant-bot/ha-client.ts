/**
 * Home Assistant WebSocket Client
 *
 * Connects to HA via WebSocket, authenticates, fetches voice-exposed entities,
 * and provides methods to query state and call services.
 */

// ---- Types ----

export interface EntityState {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
    last_updated: string;
}

interface HAMessage {
    id?: number;
    type: string;
    [key: string]: unknown;
}

interface HAResultMessage {
    id: number;
    type: 'result';
    success: boolean;
    result: unknown;
    error?: { code: string; message: string };
}

interface HAEventMessage {
    id: number;
    type: 'event';
    event: {
        event_type: string;
        data: {
            entity_id: string;
            new_state: EntityState | null;
            old_state: EntityState | null;
        };
    };
}

interface HAAuthMessage {
    type: 'auth_required' | 'auth_ok' | 'auth_invalid';
    ha_version?: string;
    message?: string;
}

type PendingRequest = {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
};

// ---- Client ----

export class HAClient {
    private ws: WebSocket | null = null;
    private messageId = 1;
    private pendingRequests = new Map<number, PendingRequest>();
    private entityStates = new Map<string, EntityState>();
    private exposedEntityIds = new Set<string>();
    private stateChangeCallbacks: ((entityId: string, newState: EntityState) => void)[] = [];
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _connected = false;
    private url: string;
    private token: string;

    constructor(url: string, token: string) {
        // Convert http(s) URL to ws(s) URL
        this.url = url.replace(/^http/, 'ws') + '/api/websocket';
        this.token = token;
    }

    get connected(): boolean {
        return this._connected;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to Home Assistant at ${this.url}...`);

            const ws = new WebSocket(this.url);
            this.ws = ws;

            let authenticated = false;

            ws.addEventListener('open', () => {
                console.log('WebSocket connection opened');
            });

            ws.addEventListener('message', (event) => {
                const msg = JSON.parse(String(event.data));

                // Handle auth flow
                if (msg.type === 'auth_required') {
                    ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
                    return;
                }

                if (msg.type === 'auth_ok') {
                    console.log(`Authenticated with HA ${(msg as HAAuthMessage).ha_version}`);
                    this._connected = true;
                    this.reconnectAttempts = 0;
                    authenticated = true;
                    resolve();
                    return;
                }

                if (msg.type === 'auth_invalid') {
                    const err = new Error(`HA auth failed: ${(msg as HAAuthMessage).message}`);
                    this._connected = false;
                    reject(err);
                    return;
                }

                // Handle event subscriptions
                if (msg.type === 'event') {
                    this.handleEvent(msg as HAEventMessage);
                    return;
                }

                // Handle request/response
                if (msg.type === 'result' && msg.id != null) {
                    const pending = this.pendingRequests.get(msg.id);
                    if (pending) {
                        this.pendingRequests.delete(msg.id);
                        const result = msg as HAResultMessage;
                        if (result.success) {
                            pending.resolve(result.result);
                        } else {
                            pending.reject(new Error(result.error?.message || 'Unknown HA error'));
                        }
                    }
                }
            });

            ws.addEventListener('close', () => {
                this._connected = false;
                if (authenticated) {
                    console.log('WebSocket connection closed');
                    this.scheduleReconnect();
                }
            });

            ws.addEventListener('error', (event) => {
                console.error('WebSocket error:', event);
                if (!authenticated) {
                    reject(new Error('WebSocket connection failed'));
                }
            });
        });
    }

    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
    }

    /**
     * Initialize: fetch exposed entities, all states, and subscribe to changes.
     */
    async initialize(): Promise<void> {
        // Fetch voice-exposed entity IDs
        const exposedResult = (await this.sendCommand({
            type: 'homeassistant/expose_entity/list',
        })) as {
            exposed_entities: Record<string, Record<string, boolean>>;
        };

        // Filter to entities exposed to the "conversation" assistant
        for (const [entityId, assistants] of Object.entries(exposedResult.exposed_entities)) {
            if (assistants['conversation']) {
                this.exposedEntityIds.add(entityId);
            }
        }

        console.log(`Found ${this.exposedEntityIds.size} voice-exposed entities`);

        // Fetch all current states
        const states = (await this.sendCommand({
            type: 'get_states',
        })) as EntityState[];

        for (const state of states) {
            if (this.exposedEntityIds.has(state.entity_id)) {
                this.entityStates.set(state.entity_id, state);
            }
        }

        // Subscribe to state changes
        await this.sendCommand({
            type: 'subscribe_events',
            event_type: 'state_changed',
        });

        console.log('Subscribed to state_changed events');
    }

    /**
     * Get all voice-exposed entities with their current states.
     */
    getExposedEntities(): EntityState[] {
        return Array.from(this.entityStates.values());
    }

    /**
     * Get a single entity's current state.
     */
    getEntityState(entityId: string): EntityState | null {
        return this.entityStates.get(entityId) ?? null;
    }

    /**
     * Call a Home Assistant service.
     */
    async callService(
        domain: string,
        service: string,
        data?: Record<string, unknown>,
        target?: { entity_id: string | string[] },
    ): Promise<unknown> {
        const command: HAMessage = {
            type: 'call_service',
            domain,
            service,
            service_data: data || {},
        };

        if (target) {
            command.target = target;
        }

        return this.sendCommand(command);
    }

    /**
     * Register a callback for state changes on exposed entities.
     */
    onStateChanged(callback: (entityId: string, newState: EntityState) => void): void {
        this.stateChangeCallbacks.push(callback);
    }

    // ---- Private Methods ----

    private sendCommand(command: HAMessage): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this._connected) {
                reject(new Error('Not connected to Home Assistant'));
                return;
            }

            const id = this.messageId++;
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ ...command, id }));
        });
    }

    private handleEvent(msg: HAEventMessage): void {
        const { entity_id, new_state } = msg.event.data;

        // Only track exposed entities
        if (!this.exposedEntityIds.has(entity_id) || !new_state) return;

        this.entityStates.set(entity_id, new_state);

        for (const cb of this.stateChangeCallbacks) {
            try {
                cb(entity_id, new_state);
            } catch (err) {
                console.error('State change callback error:', err);
            }
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            return;
        }

        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
        this.reconnectAttempts++;
        console.log(
            `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
        );

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
                await this.initialize();
                console.log('Reconnected to Home Assistant');
            } catch (err) {
                console.error('Reconnect failed:', err);
                this.scheduleReconnect();
            }
        }, delay);
    }
}

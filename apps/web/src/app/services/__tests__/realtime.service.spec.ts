import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, NgZone } from '@angular/core';
import { RealtimeService } from '../realtime.service';
import { AuthService } from '../auth.service';
import { signal } from '@angular/core';

describe('RealtimeService', () => {
    let service: RealtimeService;
    let mockAuthService: jasmine.SpyObj<AuthService>;
    let mockWebSocket: jasmine.SpyObj<WebSocket>;
    let originalWebSocket: typeof WebSocket;

    beforeEach(() => {
        // Save original WebSocket
        originalWebSocket = (window as unknown as { WebSocket: typeof WebSocket }).WebSocket;

        // Create mock WebSocket
        mockWebSocket = jasmine.createSpyObj('WebSocket', ['send', 'close'], {
            readyState: WebSocket.OPEN,
        });

        // Mock WebSocket constructor
        (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = jasmine.createSpy('WebSocket').and.callFake(() => {
            return mockWebSocket;
        }) as unknown as typeof WebSocket;

        mockAuthService = jasmine.createSpyObj('AuthService', [], {
            accessToken: signal('test-token'),
        });

        TestBed.configureTestingModule({
            providers: [
                RealtimeService,
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: AuthService, useValue: mockAuthService },
            ],
        });

        service = TestBed.inject(RealtimeService);
    });

    afterEach(() => {
        // Restore original WebSocket
        (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
        service.disconnect();
    });

    describe('connect', () => {
        it('should create WebSocket connection with token', async () => {
            await service.connect();

            expect(window.WebSocket).toHaveBeenCalledWith(
                jasmine.stringMatching(/ws:\/\/localhost:7071\/ws\/chat\?token=test-token/)
            );
        });

        it('should not connect without auth token', async () => {
            (mockAuthService as unknown as { accessToken: () => string | null }).accessToken = signal(null);

            await service.connect();

            expect(window.WebSocket).not.toHaveBeenCalled();
        });

        it('should set status to connecting', async () => {
            const connectPromise = service.connect();

            expect(service.status()).toBe('connecting');

            await connectPromise;
        });
    });

    describe('message handling', () => {
        it('should emit events for chat messages', (done) => {
            service.connect();

            const chatEvent = {
                action: 'message',
                data: { _id: 'msg-1', content: 'test' },
                tagId: 'tag-1',
                userId: 'user-1',
                timestamp: new Date().toISOString(),
            };

            service.events$.subscribe((event) => {
                expect(event.action).toBe('message');
                expect(event.tagId).toBe('tag-1');
                done();
            });

            // Simulate WebSocket message - need to run in NgZone
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onmessage) {
                    mockWebSocket.onmessage({ data: JSON.stringify(chatEvent) } as MessageEvent);
                }
            });
        });

        it('should emit typing events', (done) => {
            service.connect();

            const typingEvent = {
                action: 'typing',
                data: { tagId: 'tag-1', userId: 'user-1', isTyping: true },
                tagId: 'tag-1',
                userId: 'user-1',
                timestamp: new Date().toISOString(),
            };

            service.typing$.subscribe((event) => {
                expect(event.tagId).toBe('tag-1');
                expect(event.isTyping).toBeTrue();
                done();
            });

            // Simulate WebSocket message
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onmessage) {
                    mockWebSocket.onmessage({ data: JSON.stringify(typingEvent) } as MessageEvent);
                }
            });
        });

        it('should update subscribedTags on connected message', () => {
            service.connect();

            const connectedMsg = {
                type: 'connected',
                subscribedTags: ['tag-1', 'tag-2'],
            };

            // Simulate WebSocket message
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onmessage) {
                    mockWebSocket.onmessage({ data: JSON.stringify(connectedMsg) } as MessageEvent);
                }
            });

            expect(service.subscribedTags()).toEqual(['tag-1', 'tag-2']);
        });
    });

    describe('sendTyping', () => {
        it('should send typing indicator', async () => {
            await service.connect();

            // Simulate open event
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onopen) {
                    mockWebSocket.onopen({} as Event);
                }
            });

            service.sendTyping('tag-1', true);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'typing', tagId: 'tag-1', isTyping: true })
            );
        });
    });

    describe('subscribe/unsubscribe', () => {
        it('should send subscribe message', async () => {
            await service.connect();

            // Simulate open event
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onopen) {
                    mockWebSocket.onopen({} as Event);
                }
            });

            service.subscribe('tag-1');

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'subscribe', tagId: 'tag-1' })
            );
        });

        it('should send unsubscribe message', async () => {
            await service.connect();

            // Simulate open event
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onopen) {
                    mockWebSocket.onopen({} as Event);
                }
            });

            service.unsubscribe('tag-1');

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'unsubscribe', tagId: 'tag-1' })
            );
        });
    });

    describe('disconnect', () => {
        it('should close WebSocket connection', async () => {
            await service.connect();

            service.disconnect();

            expect(mockWebSocket.close).toHaveBeenCalledWith(1000, 'Client disconnect');
            expect(service.status()).toBe('disconnected');
        });
    });

    describe('filtering', () => {
        it('should filter messages by tag', (done) => {
            service.connect();

            const msg1 = {
                action: 'message',
                data: { _id: 'msg-1' },
                tagId: 'tag-1',
                userId: 'user-1',
                timestamp: new Date().toISOString(),
            };

            const msg2 = {
                action: 'message',
                data: { _id: 'msg-2' },
                tagId: 'tag-2',
                userId: 'user-1',
                timestamp: new Date().toISOString(),
            };

            const receivedMessages: unknown[] = [];
            service.messagesForTag('tag-1').subscribe((event) => {
                receivedMessages.push(event);
                if (receivedMessages.length === 1) {
                    expect((receivedMessages[0] as { tagId: string }).tagId).toBe('tag-1');
                    done();
                }
            });

            // Simulate WebSocket messages
            const ngZone = TestBed.inject(NgZone);
            ngZone.run(() => {
                if (mockWebSocket.onmessage) {
                    mockWebSocket.onmessage({ data: JSON.stringify(msg2) } as MessageEvent);
                    mockWebSocket.onmessage({ data: JSON.stringify(msg1) } as MessageEvent);
                }
            });
        });
    });
});

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RealtimeWSService } from './realtime-ws.service';
import { AuthService } from './auth.service';
import { VisibilityService } from './visibility.service';
import { type NativeServerEndpoint } from './server-endpoint';

class SocketStub {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: SocketStub[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => (this.readyState = 3));
  constructor(readonly url: string) {
    SocketStub.instances.push(this);
  }
}

const browser = window as Window & { __mapleServerIdentity?: NativeServerEndpoint };
describe('native realtime route recovery', () => {
  let service: RealtimeWSService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SocketStub);
    SocketStub.instances = [];
    browser.__mapleServerIdentity = {
      serverUrl: 'https://primary.example',
      publicApiUrl: 'https://primary.example',
      apiUrl: 'https://local.example',
      localUrl: 'https://local.example',
    };
    TestBed.configureTestingModule({
      providers: [
        RealtimeWSService,
        { provide: AuthService, useValue: { accessToken: () => 'test-token' } },
        { provide: VisibilityService, useValue: { becameVisible$: new Subject() } },
      ],
    });
    service = TestBed.inject(RealtimeWSService);
  });
  afterEach(() => {
    service.disconnect();
    TestBed.resetTestingModule();
    delete browser.__mapleServerIdentity;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('replaces a stuck local handshake with a public connection after five seconds', async () => {
    service.connect();
    const local = SocketStub.instances[0];
    expect(local.url).toBe('wss://local.example/ws/realtime');
    await vi.advanceTimersByTimeAsync(5000);
    expect(local.close).toHaveBeenCalledOnce();
    expect(SocketStub.instances[1].url).toBe('wss://primary.example/ws/realtime');
    expect(browser.__mapleServerIdentity?.serverUrl).toBe('https://primary.example');
  });
  it('waits for server readiness, rather than just an open socket, before accepting LAN', async () => {
    service.connect();
    SocketStub.instances[0].onopen?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(SocketStub.instances).toHaveLength(2);
    expect(service.ready()).toBe(false);
  });
  it('keeps a responsive local connection and cancels its handshake deadline', async () => {
    service.connect();
    const local = SocketStub.instances[0];
    local.onopen?.();
    local.onmessage?.({
      data: JSON.stringify({ channel: 'system', event: { type: 'connected' } }),
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(SocketStub.instances).toHaveLength(1);
    expect(service.ready()).toBe(true);
  });
});

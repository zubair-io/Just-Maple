import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { NativeBridgeService } from './native-bridge.service';

afterEach(() => {
  delete (window as unknown as { webkit?: unknown }).webkit;
  vi.useRealTimers();
});

describe('Native file requests', () => {
  it('matches out-of-order replies and subscribes before a synchronous reply', async () => {
    const posted: Array<{ payload: { requestId: string } }> = [];
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: {
        messageHandlers: {
          nativeBridge: { postMessage: (json: string) => posted.push(JSON.parse(json)) },
        },
      },
    });
    const bridge = new NativeBridgeService();
    const first = firstValueFrom(
      bridge.fileRequest<{ content: string }>('readFile', { path: '/first.md' }),
    );
    const second = firstValueFrom(
      bridge.fileRequest<{ content: string }>('readFile', { path: '/second.md' }),
    );
    window.__nativeBridge__!.receive({
      type: 'fileReadResult',
      payload: { requestId: posted[1].payload.requestId, content: 'Second' },
    });
    window.__nativeBridge__!.receive({
      type: 'fileReadResult',
      payload: { requestId: posted[0].payload.requestId, content: 'First' },
    });
    expect((await first).content).toBe('First');
    expect((await second).content).toBe('Second');
    window.webkit!.messageHandlers.nativeBridge.postMessage = (json: string) => {
      const request = JSON.parse(json);
      window.__nativeBridge__!.receive({
        type: 'fileReadResult',
        payload: { requestId: request.payload.requestId, content: 'Immediate' },
      });
    };
    expect(
      (
        await firstValueFrom(
          bridge.fileRequest<{ content: string }>('readFile', { path: '/now.md' }),
        )
      ).content,
    ).toBe('Immediate');
  });

  it('times out a lost reply instead of leaving a save waiting forever', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: {
        messageHandlers: { nativeBridge: { postMessage: vi.fn() } },
      },
    });
    const bridge = new NativeBridgeService();
    const request = firstValueFrom(
      bridge.fileRequest('writeFile', { path: '/note.md', content: 'Draft' }),
    );
    const assertion = expect(request).rejects.toThrow('Timeout');
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });
});

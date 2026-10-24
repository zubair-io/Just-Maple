import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridgeService } from '../native-bridge.service';

describe('Native recorder bridge', () => {
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  const postMessage = vi.fn();
  let originalWebkit: PropertyDescriptor | undefined;
  let originalReceiver: unknown;
  beforeAll(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  beforeEach(() => {
    originalWebkit = Object.getOwnPropertyDescriptor(window, 'webkit');
    originalReceiver = window.__nativeBridge__;
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: { messageHandlers: { nativeBridge: { postMessage } } },
    });
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: Router, useValue: router }],
    });
  });
  afterEach(() => {
    if (originalWebkit) Object.defineProperty(window, 'webkit', originalWebkit);
    else delete (window as any).webkit;
    (window as any).__nativeBridge__ = originalReceiver;
    TestBed.resetTestingModule();
  });
  it('opens the web recorder for recording Shortcuts', () => {
    TestBed.inject(NativeBridgeService);
    window.__nativeBridge__!.receive({ type: 'recorderOpen', payload: {} });
    expect(router.navigate).toHaveBeenCalledWith(['/recorder']);
  });
  it('handles a Shortcut delivered before Angular boots', () => {
    (window as any).__nativeBridge__ = { _buffer: [{ type: 'recorderOpen', payload: {} }] };
    TestBed.inject(NativeBridgeService);
    expect(router.navigate).toHaveBeenCalledWith(['/recorder']);
  });
  it('sends correlated requests without logging write-only keys', () => {
    const log = vi.spyOn(console, 'log');
    const bridge = TestBed.inject(NativeBridgeService);
    const payload = {
      requestId: 'keys-1',
      operation: 'settings' as const,
      settings: { claudeKey: 'test-key' },
    };
    bridge.recorderRequest(payload);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: 'recorderRequest', payload });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('cleans note text through a correlated native S1 request', async () => {
    const bridge = TestBed.inject(NativeBridgeService);
    const result = bridge.cleanTextWithS1('um this is the raw note');
    const request = JSON.parse(postMessage.mock.calls[0][0]);

    expect(request.type).toBe('s1CleanRequest');
    expect(request.payload.text).toBe('um this is the raw note');

    window.__nativeBridge__!.receive({
      type: 's1CleanResponse',
      payload: { requestId: request.payload.requestId, text: 'This is the clean note.' },
    });

    await expect(result).resolves.toBe('This is the clean note.');
  });
});

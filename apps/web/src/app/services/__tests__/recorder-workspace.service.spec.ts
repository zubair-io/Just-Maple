import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridgeService } from '../native-bridge.service';
import { RecorderWorkspaceService } from '../recorder-workspace.service';
import type { NativeToWebMessage } from '../../types/native-bridge.types';
import { recorderFixture } from '../../pages/recorder/__tests__/recorder.fixture';

describe('RecorderWorkspaceService', () => {
  beforeAll(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  let messages: Subject<NativeToWebMessage>;
  let bridge: {
    isNativeApp: ReturnType<typeof vi.fn>;
    messages$: ReturnType<Subject<NativeToWebMessage>['asObservable']>;
    recorderRequest: ReturnType<typeof vi.fn>;
  };
  let service: RecorderWorkspaceService;
  beforeEach(() => {
    vi.useFakeTimers();
    messages = new Subject();
    bridge = {
      isNativeApp: vi.fn(() => true),
      messages$: messages.asObservable(),
      recorderRequest: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: NativeBridgeService, useValue: bridge },
      ],
    });
    service = TestBed.inject(RecorderWorkspaceService);
  });
  afterEach(() => {
    service.close();
    vi.clearAllTimers();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });
  function respond(index: number, extras: Record<string, unknown> = {}) {
    messages.next({
      type: 'recorderResponse',
      payload: { requestId: bridge.recorderRequest.mock.calls[index][0].requestId, ...extras },
    });
  }
  it('correlates concurrent commands and ignores responses for other requests', async () => {
    const one = service.command({ operation: 'refresh' });
    const two = service.command({ operation: 'export' });
    messages.next({
      type: 'recorderResponse',
      payload: { requestId: 'unrelated', error: 'ignore' },
    });
    respond(1, { exported: '# Recording' });
    respond(0, { state: recorderFixture() });
    expect((await two).exported).toBe('# Recording');
    expect((await one).state?.recordings[0].title).toBe('Product planning');
    expect(service.error()).toBeNull();
  });
  it('does not let an older response overwrite a newer selection', async () => {
    const one = service.command({ operation: 'state' });
    const two = service.select('NEW');
    const old = recorderFixture();
    const current = recorderFixture();
    current.selected!.id = 'NEW';
    respond(1, { state: current });
    respond(0, { state: old });
    await Promise.all([one, two]);
    expect(service.state()?.selected?.id).toBe('NEW');
  });
  it('exposes native errors and rejects the matching command', async () => {
    const promise = service.command({ operation: 'start' });
    const assertion = expect(promise).rejects.toThrow('Microphone permission denied');
    respond(0, { error: 'Microphone permission denied' });
    await assertion;
    expect(service.error()).toBe('Microphone permission denied');
  });
  it('times out unsupported older app versions instead of waiting forever', async () => {
    const promise = service.command({ operation: 'state' });
    const assertion = expect(promise).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });
  it('polls only while open and deduplicates slow polls', async () => {
    service.open();
    await vi.advanceTimersByTimeAsync(5000);
    expect(bridge.recorderRequest).toHaveBeenCalledTimes(1);
    respond(0, { state: recorderFixture() });
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.recorderRequest).toHaveBeenCalledTimes(2);
    service.close();
    respond(1, { state: recorderFixture() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(bridge.recorderRequest).toHaveBeenCalledTimes(2);
  });
  it('keeps recording status current after leaving the workspace and stops when work finishes', async () => {
    service.open();
    const active = recorderFixture();
    active.isRecording = true;
    respond(0, { state: active });
    await vi.advanceTimersByTimeAsync(1);
    service.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.recorderRequest).toHaveBeenCalledTimes(2);
    respond(1, { state: recorderFixture() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(bridge.recorderRequest).toHaveBeenCalledTimes(2);
  });
  it('rejects browser-only usage without sending native requests', async () => {
    TestBed.resetTestingModule();
    bridge.isNativeApp.mockReturnValue(false);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: NativeBridgeService, useValue: bridge },
      ],
    });
    service = TestBed.inject(RecorderWorkspaceService);
    await expect(service.command({ operation: 'start' })).rejects.toThrow('Apple app');
    expect(bridge.recorderRequest).not.toHaveBeenCalled();
  });
});

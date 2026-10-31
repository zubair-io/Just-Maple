import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceConversationService } from './voice-conversation.service';
import { WhisperService } from './whisper.service';

class Recorder {
  static latest: Recorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}
describe('conversational voice lifecycle', () => {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const transcribe = vi.fn();
  let service: VoiceConversationService;
  beforeEach(() => {
    stopTrack.mockClear();
    transcribe.mockReset();
    vi.stubGlobal('MediaRecorder', Recorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    TestBed.configureTestingModule({
      providers: [
        VoiceConversationService,
        {
          provide: WhisperService,
          useValue: { isLoading: signal(false), isTranscribing: signal(false), transcribe },
        },
      ],
    });
    service = TestBed.inject(VoiceConversationService);
  });
  afterEach(() => {
    service?.stop();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('releases the microphone before transcribing the explicit completed turn', async () => {
    transcribe.mockImplementation(async () => {
      expect(stopTrack).toHaveBeenCalledOnce();
      return { text: '  My question  ' };
    });
    await service.start();
    expect(service.state()).toBe('listening');
    expect(transcribe).not.toHaveBeenCalled();
    expect(await service.finish()).toBe('My question');
    expect(service.state()).toBe('idle');
  });
  it('discards a late transcript after cancellation', async () => {
    let resolve!: (value: { text: string }) => void;
    transcribe.mockImplementation(() => new Promise((r) => (resolve = r)));
    await service.start();
    const finishing = service.finish();
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled());
    service.stop();
    resolve({ text: 'Do not send this' });
    expect(await finishing).toBe('');
  });
  it('releases permission granted after the conversation was closed', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      () => new Promise((r) => (resolve = r)) as Promise<MediaStream>,
    );
    const starting = service.start();
    service.stop();
    resolve(stream);
    await starting;
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(service.state()).toBe('idle');
  });
  it('does not fall back to a remote speech voice', () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      getVoices: () => [{ localService: false, lang: 'en-US' }],
      speak,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    service.speak('A private reply');
    expect(speak).not.toHaveBeenCalled();
    expect(service.error()).toContain('No local voice');
  });
});

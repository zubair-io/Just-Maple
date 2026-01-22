import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RecordingService } from '../recording.service';
import { NativeBridgeService } from '../native-bridge.service';
import { firstValueFrom, Subject } from 'rxjs';
import type { Recording } from '@maple/shared';

describe('RecordingService', () => {
  let service: RecordingService;
  let httpMock: HttpTestingController;
  let nativeBridgeMock: {
    isNativeApp: ReturnType<typeof vi.fn>;
    startRecording: ReturnType<typeof vi.fn>;
    stopRecording: ReturnType<typeof vi.fn>;
    cancelRecording: ReturnType<typeof vi.fn>;
    onAudioLevel: ReturnType<typeof vi.fn>;
    onRecordingStarted: ReturnType<typeof vi.fn>;
    onRecordingStopped: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
  };

  const mockRecording: Recording = {
    _id: 'rec123',
    id: 'uuid-123',
    userId: 'user123',
    state: 'empty',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    nativeBridgeMock = {
      isNativeApp: vi.fn().mockReturnValue(false),
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      cancelRecording: vi.fn(),
      onAudioLevel: vi.fn().mockReturnValue(new Subject()),
      onRecordingStarted: vi.fn().mockReturnValue(new Subject()),
      onRecordingStopped: vi.fn().mockReturnValue(new Subject()),
      onError: vi.fn().mockReturnValue(new Subject()),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RecordingService, { provide: NativeBridgeService, useValue: nativeBridgeMock }],
    });

    service = TestBed.inject(RecordingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      expect(service.activeRecordingId()).toBeNull();
      expect(service.isRecording()).toBe(false);
      expect(service.isPaused()).toBe(false);
      expect(service.audioLevel()).toBe(0);
      expect(service.duration()).toBe(0);
      expect(service.error()).toBeNull();
    });

    it('should detect native app availability', () => {
      expect(service.canUseNative()).toBe(false);

      nativeBridgeMock.isNativeApp.mockReturnValue(true);
      // Need to re-create service to pick up new value
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          RecordingService,
          {
            provide: NativeBridgeService,
            useValue: { ...nativeBridgeMock, isNativeApp: vi.fn().mockReturnValue(true) },
          },
        ],
      });
      const newService = TestBed.inject(RecordingService);
      httpMock = TestBed.inject(HttpTestingController);
      expect(newService.canUseNative()).toBe(true);
    });
  });

  describe('createRecording', () => {
    it('should POST to /api/recordings', async () => {
      const promise = firstValueFrom(service.createRecording('uuid-123', false));

      const req = httpMock.expectOne('/api/recordings');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        id: 'uuid-123',
        isMultiTrack: false,
        notebookId: undefined,
      });

      req.flush({ recording: mockRecording });

      const result = await promise;
      expect(result.id).toBe('uuid-123');
    });

    it('should include notebookId for broadcast', async () => {
      const promise = firstValueFrom(service.createRecording('uuid-123', false, 'notebook-456'));

      const req = httpMock.expectOne('/api/recordings');
      expect(req.request.body.notebookId).toBe('notebook-456');

      req.flush({ recording: mockRecording });
      await promise;
    });

    it('should set error on failure', async () => {
      const promise = service.createRecording('uuid-123', false);

      const req = httpMock.expectOne('/api/recordings');
      req.flush({ error: 'Failed to create' }, { status: 500, statusText: 'Server Error' });

      await expect(firstValueFrom(promise)).rejects.toThrow('Failed to create');
      expect(service.error()).toBe('Failed to create');
    });
  });

  describe('getRecording', () => {
    it('should GET recording by id', async () => {
      const promise = firstValueFrom(service.getRecording('uuid-123'));

      const req = httpMock.expectOne('/api/recordings/uuid-123');
      expect(req.request.method).toBe('GET');

      req.flush({ recording: mockRecording });

      const result = await promise;
      expect(result?.id).toBe('uuid-123');
    });

    it('should return null for 404', async () => {
      const promise = firstValueFrom(service.getRecording('nonexistent'));

      const req = httpMock.expectOne('/api/recordings/nonexistent');
      req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('uploadRecording', () => {
    it('should POST base64 audio data', async () => {
      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      const promise = firstValueFrom(service.uploadRecording('uuid-123', audioBlob, 10.5));

      // Wait for FileReader to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      const req = httpMock.expectOne('/api/recordings/uuid-123/upload');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.duration).toBe(10.5);
      expect(req.request.body.mimeType).toBe('audio/webm');
      expect(req.request.body.audioData).toBeTruthy();

      const completeRecording: Recording = { ...mockRecording, state: 'complete', duration: 10.5 };
      req.flush({ recording: completeRecording });

      const result = await promise;
      expect(result.state).toBe('complete');
      expect(result.duration).toBe(10.5);
    });

    it('should include notebookId for broadcast', async () => {
      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      const promise = firstValueFrom(
        service.uploadRecording('uuid-123', audioBlob, 10.5, 'notebook-456'),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const req = httpMock.expectOne('/api/recordings/uuid-123/upload');
      expect(req.request.body.notebookId).toBe('notebook-456');

      req.flush({ recording: { ...mockRecording, state: 'complete' } });
      await promise;
    });
  });

  describe('saveTranscription', () => {
    it('should PUT transcription text', async () => {
      const promise = firstValueFrom(service.saveTranscription('uuid-123', 'Hello world'));

      const req = httpMock.expectOne('/api/recordings/uuid-123/transcription');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.transcription).toBe('Hello world');

      const withTranscription: Recording = { ...mockRecording, transcription: 'Hello world' };
      req.flush({ recording: withTranscription });

      const result = await promise;
      expect(result.transcription).toBe('Hello world');
    });

    it('should include segments if provided', async () => {
      const segments = [{ text: 'Hello', start: 0, end: 1 }];
      const promise = firstValueFrom(
        service.saveTranscription('uuid-123', 'Hello', segments, 'notebook-456'),
      );

      const req = httpMock.expectOne('/api/recordings/uuid-123/transcription');
      expect(req.request.body.segments).toEqual(segments);
      expect(req.request.body.notebookId).toBe('notebook-456');

      req.flush({ recording: { ...mockRecording, transcription: 'Hello', segments } });
      await promise;
    });
  });

  describe('deleteRecording', () => {
    it('should DELETE recording', async () => {
      const promise = firstValueFrom(service.deleteRecording('uuid-123'));

      const req = httpMock.expectOne('/api/recordings/uuid-123');
      expect(req.request.method).toBe('DELETE');

      req.flush({ message: 'Deleted' });

      await promise;
      // Should complete without error
    });

    it('should set error on failure', async () => {
      const promise = service.deleteRecording('uuid-123');

      const req = httpMock.expectOne('/api/recordings/uuid-123');
      req.flush({ error: 'Failed to delete' }, { status: 500, statusText: 'Server Error' });

      await expect(firstValueFrom(promise)).rejects.toThrow('Failed to delete');
      expect(service.error()).toBe('Failed to delete');
    });
  });

  describe('updateRecordingState', () => {
    it('should PUT new state', async () => {
      const promise = firstValueFrom(service.updateRecordingState('uuid-123', 'recording'));

      const req = httpMock.expectOne('/api/recordings/uuid-123/state');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.state).toBe('recording');

      req.flush({ recording: { ...mockRecording, state: 'recording' } });

      const result = await promise;
      expect(result.state).toBe('recording');
    });
  });

  describe('native recording', () => {
    it('should call native bridge startRecording', () => {
      service.startNativeRecording('uuid-123', true);

      expect(nativeBridgeMock.startRecording).toHaveBeenCalledWith({ includeSystemAudio: true });
      expect(service.activeRecordingId()).toBe('uuid-123');
    });

    it('should call native bridge cancelRecording', () => {
      service.startNativeRecording('uuid-123', false);
      service.cancelNativeRecording();

      expect(nativeBridgeMock.cancelRecording).toHaveBeenCalled();
      expect(service.activeRecordingId()).toBeNull();
      expect(service.isRecording()).toBe(false);
    });
  });

  describe('web recording support', () => {
    it('should detect web recording support', () => {
      // In test environment, these APIs may not be available
      const supported = service.isWebRecordingSupported();
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      service['_activeRecordingId'].set('uuid-123');
      service['_error'].set('Some error');

      service.reset();

      expect(service.activeRecordingId()).toBeNull();
      expect(service.error()).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      service['_error'].set('Some error');
      expect(service.error()).toBe('Some error');

      service.clearError();
      expect(service.error()).toBeNull();
    });
  });
});

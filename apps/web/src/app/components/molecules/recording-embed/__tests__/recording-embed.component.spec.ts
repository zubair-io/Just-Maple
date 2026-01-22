import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Subject, of } from 'rxjs';
import { RecordingEmbedComponent } from '../recording-embed.component';
import { RecordingService } from '../../../../services/recording.service';
import { AuthService } from '../../../../services/auth.service';
import { RealtimeWSService } from '../../../../services/realtime-ws.service';
import { NativeBridgeService } from '../../../../services/native-bridge.service';
import type { Recording } from '@maple/shared';

describe('RecordingEmbedComponent', () => {
  let component: RecordingEmbedComponent;
  let fixture: ComponentFixture<RecordingEmbedComponent>;

  let recordingServiceMock: {
    getRecording: ReturnType<typeof vi.fn>;
    createRecording: ReturnType<typeof vi.fn>;
    uploadRecording: ReturnType<typeof vi.fn>;
    deleteRecording: ReturnType<typeof vi.fn>;
    startNativeRecording: ReturnType<typeof vi.fn>;
    stopNativeRecording: ReturnType<typeof vi.fn>;
    cancelNativeRecording: ReturnType<typeof vi.fn>;
    startWebRecording: ReturnType<typeof vi.fn>;
    stopWebRecording: ReturnType<typeof vi.fn>;
    cancelWebRecording: ReturnType<typeof vi.fn>;
    saveTranscription: ReturnType<typeof vi.fn>;
    canUseNative: ReturnType<typeof vi.fn>;
    isRecording: ReturnType<typeof vi.fn>;
    activeRecordingId: ReturnType<typeof vi.fn>;
    audioLevel: ReturnType<typeof vi.fn>;
    duration: ReturnType<typeof vi.fn>;
  };

  let authServiceMock: {
    user: ReturnType<typeof vi.fn>;
  };

  let realtimeWSMock: {
    on: ReturnType<typeof vi.fn>;
  };

  let nativeBridgeMock: {
    isNativeApp: ReturnType<typeof vi.fn>;
    isMacOS: ReturnType<typeof vi.fn>;
    onTranscriptionComplete: ReturnType<typeof vi.fn>;
  };

  const mockRecording: Recording = {
    _id: 'rec123',
    id: 'uuid-123',
    userId: 'user123',
    state: 'empty',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const mockRecordingComplete: Recording = {
    ...mockRecording,
    state: 'complete',
    audioUrl: 'https://storage.example.com/audio.webm',
    duration: 10.5,
  };

  beforeEach(async () => {
    recordingServiceMock = {
      getRecording: vi.fn().mockReturnValue(of(null)),
      createRecording: vi.fn().mockReturnValue(of(mockRecording)),
      uploadRecording: vi.fn().mockReturnValue(of(mockRecordingComplete)),
      deleteRecording: vi.fn().mockReturnValue(of(undefined)),
      startNativeRecording: vi.fn(),
      stopNativeRecording: vi
        .fn()
        .mockReturnValue(of({ filePath: '/tmp/audio.m4a', duration: 10.5 })),
      cancelNativeRecording: vi.fn(),
      startWebRecording: vi.fn().mockResolvedValue(undefined),
      stopWebRecording: vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' })),
      cancelWebRecording: vi.fn(),
      saveTranscription: vi.fn().mockReturnValue(of(mockRecording)),
      canUseNative: vi.fn().mockReturnValue(false),
      isRecording: vi.fn().mockReturnValue(false),
      activeRecordingId: vi.fn().mockReturnValue(null),
      audioLevel: vi.fn().mockReturnValue(0),
      duration: vi.fn().mockReturnValue(0),
    };

    authServiceMock = {
      user: vi.fn().mockReturnValue({ _id: 'user123', email: 'test@example.com' }),
    };

    realtimeWSMock = {
      on: vi.fn().mockReturnValue(new Subject()),
    };

    nativeBridgeMock = {
      isNativeApp: vi.fn().mockReturnValue(false),
      isMacOS: vi.fn().mockReturnValue(false),
      onTranscriptionComplete: vi.fn().mockReturnValue(new Subject()),
    };

    await TestBed.configureTestingModule({
      imports: [RecordingEmbedComponent, HttpClientTestingModule],
      providers: [
        { provide: RecordingService, useValue: recordingServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: RealtimeWSService, useValue: realtimeWSMock },
        { provide: NativeBridgeService, useValue: nativeBridgeMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecordingEmbedComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('recordingId', 'uuid-123');
  });

  afterEach(() => {
    fixture.destroy();
  });

  describe('initialization', () => {
    it('should create component', () => {
      expect(component).toBeTruthy();
    });

    it('should show loading state initially', () => {
      fixture.detectChanges();

      const loading = fixture.nativeElement.querySelector('.recording-loading');
      expect(loading).not.toBeNull();
    });
  });

  describe('state rendering', () => {
    it('should show empty state when no recording exists', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      const emptyState = fixture.nativeElement.querySelector('.recording-empty');
      expect(emptyState).not.toBeNull();
    });

    it('should show record button for owner', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      const recordButton = fixture.nativeElement.querySelector('.record-button');
      expect(recordButton).not.toBeNull();
    });

    it('should show waiting message for non-owner', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'other-user');
      fixture.detectChanges();
      await fixture.whenStable();

      const waitingState = fixture.nativeElement.querySelector('.recording-waiting');
      expect(waitingState).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Waiting for recording');
    });

    it('should show complete state with audio player', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(mockRecordingComplete));
      fixture.detectChanges();
      await fixture.whenStable();

      const completeState = fixture.nativeElement.querySelector('.recording-complete');
      expect(completeState).not.toBeNull();
    });

    it('should show failed state with retry button', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      // Manually set state to failed
      component['state'].set('failed');
      component['error'].set('Recording failed');
      fixture.detectChanges();

      const failedState = fixture.nativeElement.querySelector('.recording-failed');
      expect(failedState).not.toBeNull();

      const retryButton = fixture.nativeElement.querySelector('.retry-button');
      expect(retryButton).not.toBeNull();
    });
  });

  describe('system audio toggle', () => {
    it('should hide on web browser', async () => {
      recordingServiceMock.canUseNative.mockReturnValue(false);
      nativeBridgeMock.isMacOS.mockReturnValue(false);
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      const toggle = fixture.nativeElement.querySelector('.system-audio-toggle');
      expect(toggle).toBeNull();
    });

    it('should hide on iOS native app', async () => {
      recordingServiceMock.canUseNative.mockReturnValue(true);
      nativeBridgeMock.isMacOS.mockReturnValue(false);
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      const toggle = fixture.nativeElement.querySelector('.system-audio-toggle');
      expect(toggle).toBeNull();
    });

    it('should show on macOS native app', async () => {
      recordingServiceMock.canUseNative.mockReturnValue(true);
      nativeBridgeMock.isMacOS.mockReturnValue(true);
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      const toggle = fixture.nativeElement.querySelector('.system-audio-toggle');
      expect(toggle).not.toBeNull();
    });
  });

  describe('ownership', () => {
    it('should detect owner correctly', async () => {
      authServiceMock.user.mockReturnValue({ _id: 'user123' });
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isOwner()).toBe(true);
    });

    it('should detect non-owner correctly', async () => {
      authServiceMock.user.mockReturnValue({ _id: 'user123' });
      fixture.componentRef.setInput('createdBy', 'other-user');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isOwner()).toBe(false);
    });

    it('should allow recording if no creator set (backward compatibility)', async () => {
      authServiceMock.user.mockReturnValue({ _id: 'user123' });
      // createdBy is null/not set
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isOwner()).toBe(true);
    });
  });

  describe('recording flow', () => {
    beforeEach(async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should call startRecording on button click', async () => {
      const recordButton = fixture.nativeElement.querySelector('.record-button');
      expect(recordButton).not.toBeNull();

      recordButton.click();
      await fixture.whenStable();

      expect(recordingServiceMock.createRecording).toHaveBeenCalledWith(
        'uuid-123',
        false,
        undefined,
      );
    });

    it('should use native recording when available', async () => {
      recordingServiceMock.canUseNative.mockReturnValue(true);
      fixture.detectChanges();

      await component.startRecording();

      expect(recordingServiceMock.createRecording).toHaveBeenCalledWith(
        'uuid-123',
        true,
        undefined,
      );
      expect(recordingServiceMock.startNativeRecording).toHaveBeenCalled();
    });

    it('should use web recording when native not available', async () => {
      recordingServiceMock.canUseNative.mockReturnValue(false);
      fixture.detectChanges();

      await component.startRecording();

      expect(recordingServiceMock.startWebRecording).toHaveBeenCalledWith('uuid-123');
    });
  });

  describe('cancel recording', () => {
    beforeEach(async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(null));
      fixture.componentRef.setInput('createdBy', 'user123');
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should call cancelNativeRecording for native', () => {
      recordingServiceMock.canUseNative.mockReturnValue(true);
      fixture.detectChanges();

      component.cancelRecording();

      expect(recordingServiceMock.cancelNativeRecording).toHaveBeenCalled();
    });

    it('should call cancelWebRecording for web', () => {
      recordingServiceMock.canUseNative.mockReturnValue(false);
      fixture.detectChanges();

      component.cancelRecording();

      expect(recordingServiceMock.cancelWebRecording).toHaveBeenCalled();
    });

    it('should reset state to empty', () => {
      component['state'].set('recording');
      component.cancelRecording();

      expect(component['state']()).toBe('empty');
    });
  });

  describe('delete recording', () => {
    it('should emit deleteRequested on successful delete', async () => {
      recordingServiceMock.getRecording.mockReturnValue(of(mockRecordingComplete));
      fixture.detectChanges();
      await fixture.whenStable();

      const deleteSpy = vi.fn();
      component.deleteRequested.subscribe(deleteSpy);

      await component.deleteRecording();

      expect(recordingServiceMock.deleteRecording).toHaveBeenCalledWith('uuid-123');
      expect(deleteSpy).toHaveBeenCalledWith('uuid-123');
    });
  });

  describe('retry', () => {
    it('should reset error and state', () => {
      component['error'].set('Some error');
      component['state'].set('failed');

      component.retry();

      expect(component['error']()).toBeNull();
      expect(component['state']()).toBe('empty');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds correctly', () => {
      expect(component.formatDuration(0)).toBe('0:00');
      expect(component.formatDuration(5)).toBe('0:05');
      expect(component.formatDuration(65)).toBe('1:05');
      expect(component.formatDuration(125)).toBe('2:05');
    });
  });

  describe('system audio toggle', () => {
    it('should toggle includeSystemAudio', () => {
      expect(component.includeSystemAudio()).toBe(false);

      component.toggleSystemAudio();
      expect(component.includeSystemAudio()).toBe(true);

      component.toggleSystemAudio();
      expect(component.includeSystemAudio()).toBe(false);
    });
  });
});

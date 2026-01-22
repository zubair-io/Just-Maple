import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, of, throwError, Subject } from 'rxjs';
import { map, catchError, tap, take, timeout } from 'rxjs/operators';
import { NativeBridgeService } from './native-bridge.service';
import type { Recording, TranscriptSegment } from '@maple/shared';

export interface RecordingState {
  recordingId: string;
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioLevel: number;
}

@Injectable({ providedIn: 'root' })
export class RecordingService {
  private readonly http = inject(HttpClient);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly destroyRef = inject(DestroyRef);

  // Web recording state
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private startTime: number | null = null;
  private durationInterval: ReturnType<typeof setInterval> | null = null;

  // Signals for reactive state
  private readonly _activeRecordingId = signal<string | null>(null);
  private readonly _isRecording = signal(false);
  private readonly _isPaused = signal(false);
  private readonly _audioLevel = signal(0);
  private readonly _duration = signal(0);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly activeRecordingId = this._activeRecordingId.asReadonly();
  readonly isRecording = this._isRecording.asReadonly();
  readonly isPaused = this._isPaused.asReadonly();
  readonly audioLevel = this._audioLevel.asReadonly();
  readonly duration = this._duration.asReadonly();
  readonly error = this._error.asReadonly();

  // Computed state
  readonly canUseNative = computed(() => this.nativeBridge.isNativeApp());

  // Event subjects for native recording completion
  private readonly _recordingComplete$ = new Subject<{
    filePath: string;
    duration: number;
    audioData?: string;
    mimeType?: string;
  }>();
  readonly recordingComplete$ = this._recordingComplete$.asObservable();

  constructor() {
    this.setupNativeBridgeListeners();
  }

  /**
   * Set up listeners for native bridge recording events
   */
  private setupNativeBridgeListeners(): void {
    // Audio level updates
    this.nativeBridge
      .onAudioLevel()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this._audioLevel.set(event.level);
        this._duration.set(event.duration);
      });

    // Recording started
    this.nativeBridge
      .onRecordingStarted()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this._isRecording.set(true);
        this.startTime = Date.now();
      });

    // Recording stopped
    this.nativeBridge
      .onRecordingStopped()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        console.log('[RecordingService] Recording stopped event:', {
          filePath: event.filePath,
          duration: event.duration,
          hasAudioData: !!event.audioData,
          audioDataLength: event.audioData?.length,
          mimeType: event.mimeType,
        });
        this._isRecording.set(false);
        this._duration.set(event.duration);
        this._recordingComplete$.next({
          filePath: event.filePath,
          duration: event.duration,
          audioData: event.audioData,
          mimeType: event.mimeType,
        });
      });

    // Handle errors
    this.nativeBridge
      .onError()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        // Only handle recording-related errors
        if (event.code === 'RECORDING_ERROR' || event.code === 'PERMISSION_DENIED') {
          this._error.set(event.message);
          this._isRecording.set(false);
        }
      });
  }

  // =========================================================================
  // API Methods
  // =========================================================================

  /**
   * Create a new recording placeholder on the server
   * @param id - The unique ID for this recording (client-generated UUID)
   * @param isMultiTrack - Whether this recording captures multiple audio tracks
   * @param notebookId - The ID of the parent memo/page (for WebSocket broadcasting)
   */
  createRecording(id: string, isMultiTrack?: boolean, notebookId?: string): Observable<Recording> {
    return this.http
      .post<{ recording: Recording }>('/api/recordings', {
        id,
        isMultiTrack,
        notebookId,
      })
      .pipe(
        map((response) => response.recording),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to create recording';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Get a recording by its recordingId
   */
  getRecording(recordingId: string): Observable<Recording | null> {
    return this.http.get<{ recording: Recording }>(`/api/recordings/${recordingId}`).pipe(
      map((response) => response.recording),
      catchError((err) => {
        if (err.status === 404) {
          return of(null);
        }
        const message = err?.error?.error || 'Failed to load recording';
        this._error.set(message);
        return of(null);
      }),
    );
  }

  /**
   * Update recording state on the server
   */
  updateRecordingState(
    recordingId: string,
    state: 'empty' | 'recording' | 'uploading' | 'complete' | 'failed',
  ): Observable<Recording> {
    return this.http
      .put<{ recording: Recording }>(`/api/recordings/${recordingId}/state`, { state })
      .pipe(
        map((response) => response.recording),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to update recording state';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Upload audio data for a recording
   * @param recordingId - The recording ID
   * @param audioBlob - The audio data as a Blob
   * @param duration - The duration in seconds
   * @param notebookId - The ID of the parent memo/page (for WebSocket broadcasting)
   */
  uploadRecording(
    recordingId: string,
    audioBlob: Blob,
    duration: number,
    notebookId?: string,
  ): Observable<Recording> {
    return new Observable<Recording>((subscriber) => {
      // Convert blob to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];

        this.http
          .post<{ recording: Recording }>(`/api/recordings/${recordingId}/upload`, {
            audioData: base64,
            duration,
            mimeType: audioBlob.type || 'audio/webm',
            notebookId,
          })
          .pipe(
            map((response) => response.recording),
            catchError((err) => {
              const message = err?.error?.error || 'Failed to upload recording';
              this._error.set(message);
              return throwError(() => new Error(message));
            }),
          )
          .subscribe(subscriber);
      };
      reader.onerror = () => {
        subscriber.error(new Error('Failed to read audio blob'));
      };
      reader.readAsDataURL(audioBlob);
    });
  }

  /**
   * Save transcription for a recording
   * @param recordingId - The recording ID
   * @param transcription - The transcription text
   * @param segments - Optional transcript segments
   * @param notebookId - Optional notebook ID for WebSocket broadcasting
   */
  saveTranscription(
    recordingId: string,
    transcription: string,
    segments?: TranscriptSegment[],
    notebookId?: string,
  ): Observable<Recording> {
    return this.http
      .put<{ recording: Recording }>(`/api/recordings/${recordingId}/transcription`, {
        transcription,
        segments,
        notebookId,
      })
      .pipe(
        map((response) => response.recording),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to save transcription';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Delete a recording
   */
  deleteRecording(recordingId: string): Observable<void> {
    return this.http.delete(`/api/recordings/${recordingId}`).pipe(
      map(() => undefined),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to delete recording';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  // =========================================================================
  // Web Recording (MediaRecorder API)
  // =========================================================================

  /**
   * Start recording using the web MediaRecorder API
   */
  async startWebRecording(recordingId: string): Promise<void> {
    this._error.set(null);
    this._activeRecordingId.set(recordingId);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio analysis for level meter
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // Start level monitoring
      this.monitorAudioLevel();

      // Set up MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.onerror = () => {
        this._error.set('Recording error occurred');
        this.stopWebRecording();
      };

      // Start recording
      this.mediaRecorder.start(1000); // Collect data every second
      this._isRecording.set(true);
      this.startTime = Date.now();

      // Start duration counter
      this.durationInterval = setInterval(() => {
        if (this.startTime) {
          this._duration.set((Date.now() - this.startTime) / 1000);
        }
      }, 100);
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to start recording');
      this._activeRecordingId.set(null);
      throw err;
    }
  }

  /**
   * Stop web recording and return the audio blob
   */
  async stopWebRecording(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Clean up
        this.stopAudioAnalysis();
        if (this.durationInterval) {
          clearInterval(this.durationInterval);
          this.durationInterval = null;
        }

        this._isRecording.set(false);

        // Create blob from chunks
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];
        this.mediaRecorder = null;

        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel web recording without saving
   */
  cancelWebRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.audioChunks = [];
    this.stopAudioAnalysis();
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
    this._isRecording.set(false);
    this._activeRecordingId.set(null);
    this._duration.set(0);
    this._audioLevel.set(0);
  }

  /**
   * Get supported MIME type for recording
   */
  private getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Default fallback
  }

  /**
   * Monitor audio level for visualization
   */
  private monitorAudioLevel(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const updateLevel = () => {
      if (!this.analyser || !this._isRecording()) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, rms / 128); // Normalize to 0-1

      this._audioLevel.set(level);

      this.animationFrameId = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }

  /**
   * Stop audio analysis
   */
  private stopAudioAnalysis(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this._audioLevel.set(0);
  }

  // =========================================================================
  // Native Recording
  // =========================================================================

  /**
   * Start recording using native app
   * @param recordingId - The recording ID
   * @param includeSystemAudio - Whether to capture system audio (macOS only, default false)
   */
  startNativeRecording(recordingId: string, includeSystemAudio = false): void {
    this._error.set(null);
    this._activeRecordingId.set(recordingId);
    this._duration.set(0);
    this.nativeBridge.startRecording({ includeSystemAudio });
  }

  /**
   * Stop native recording
   * Returns observable that emits when recording is complete
   */
  stopNativeRecording(): Observable<{
    filePath: string;
    duration: number;
    audioData?: string;
    mimeType?: string;
  }> {
    this.nativeBridge.stopRecording();

    return this._recordingComplete$.pipe(
      take(1),
      timeout(30000), // 30 second timeout
      catchError(() => {
        this._error.set('Recording stop timed out');
        return throwError(() => new Error('Recording stop timed out'));
      }),
    );
  }

  /**
   * Cancel native recording without saving
   */
  cancelNativeRecording(): void {
    this.nativeBridge.cancelRecording();
    this._isRecording.set(false);
    this._activeRecordingId.set(null);
    this._duration.set(0);
    this._audioLevel.set(0);
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Reset the recording state
   */
  reset(): void {
    this.cancelWebRecording();
    this._activeRecordingId.set(null);
    this._error.set(null);
  }

  /**
   * Clear any error
   */
  clearError(): void {
    this._error.set(null);
  }

  /**
   * Check if browser supports recording
   */
  isWebRecordingSupported(): boolean {
    return (
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }
}

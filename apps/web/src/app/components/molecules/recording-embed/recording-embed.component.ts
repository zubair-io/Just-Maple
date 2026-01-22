import {
  Component,
  input,
  signal,
  computed,
  inject,
  effect,
  DestroyRef,
  ChangeDetectionStrategy,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RecordingService } from '../../../services/recording.service';
import { AuthService } from '../../../services/auth.service';
import { RealtimeWSService } from '../../../services/realtime-ws.service';
import { NativeBridgeService } from '../../../services/native-bridge.service';
import { WhisperService } from '../../../services/whisper.service';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import type { Recording } from '@maple/shared';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

type RecordingBlockState = 'empty' | 'recording' | 'uploading' | 'complete' | 'failed';

@Component({
  selector: 'app-recording-embed',
  standalone: true,
  imports: [CommonModule, AudioPlayerComponent],
  templateUrl: './recording-embed.component.html',
  styleUrl: './recording-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingEmbedComponent {
  private readonly recordingService = inject(RecordingService);
  private readonly authService = inject(AuthService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly whisperService = inject(WhisperService);
  private readonly destroyRef = inject(DestroyRef);

  readonly recordingId = input.required<string>();

  /** The user ID who created this embed (for ownership tracking) */
  readonly createdBy = input<string | null>(null);

  /** The ID of the parent memo/page containing this embed (for WebSocket broadcasting) */
  readonly parentPageId = input<string | null>(null);

  readonly deleteRequested = output<string>();

  /** Whether the current user is the owner of this recording embed */
  readonly isOwner = computed(() => {
    const currentUserId = this.authService.user()?._id;
    const creator = this.createdBy();
    // If no creator set, allow recording (backward compatibility)
    if (!creator) return true;
    return currentUserId === creator;
  });

  // Local state
  readonly recording = signal<Recording | null>(null);
  readonly state = signal<RecordingBlockState>('empty');
  readonly error = signal<string | null>(null);
  readonly isLoading = signal(true);

  /** Whether to include system audio in native recording (macOS only) */
  readonly includeSystemAudio = signal(false);

  /** Whether the recording has a playable audio URL */
  readonly hasAudioUrl = computed(() => {
    const rec = this.recording();
    return rec?.audioUrl && rec.audioUrl.length > 0;
  });

  // Computed from recording service
  readonly isCurrentlyRecording = computed(() => {
    return (
      this.recordingService.activeRecordingId() === this.recordingId() &&
      this.recordingService.isRecording()
    );
  });

  readonly audioLevel = this.recordingService.audioLevel;
  readonly duration = this.recordingService.duration;

  // Check if native recording is available
  readonly canUseNative = this.recordingService.canUseNative;

  /** System audio toggle should only show on macOS (not iOS, not web) */
  readonly showSystemAudioToggle = computed(() => {
    return this.canUseNative() && this.nativeBridge.isMacOS();
  });

  /** Whether web transcription is currently in progress */
  readonly isTranscribing = computed(() => this.whisperService.isTranscribing());

  /** Transcription model loading progress */
  readonly transcriptionProgress = this.whisperService.progress;

  constructor() {
    // Load recording when recordingId changes
    effect(() => {
      const id = this.recordingId();
      if (id) {
        this.loadRecording(id);
      }
    });

    // Subscribe to real-time recording events for non-owners
    this.realtimeWS
      .on('recording.started')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.id === this.recordingId()) {
          // Another user started recording - update state for viewers
          if (!this.isOwner()) {
            this.state.set('recording');
          }
        }
      });

    this.realtimeWS
      .on('recording.completed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.recording.id === this.recordingId()) {
          // Recording completed - update with full recording data
          this.recording.set(event.recording);
          this.state.set('complete');
        }
      });

    this.realtimeWS
      .on('recording.failed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.id === this.recordingId()) {
          // Recording failed
          this.error.set(event.error || 'Recording failed');
          this.state.set('failed');
        }
      });

    // Listen for native transcription complete
    this.nativeBridge
      .onTranscriptionComplete()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (event) => {
        // Only update if we're the active recording
        if (this.recordingService.activeRecordingId() === this.recordingId()) {
          const recordingId = this.recordingId();

          // Map native bridge segments to Recording schema format
          const mappedSegments = event.segments?.map((seg) => ({
            text: seg.text,
            start: seg.startTime,
            end: seg.endTime,
          }));

          // Save transcription to server with retry
          const notebookId = this.parentPageId() || undefined;
          const saved = await this.saveTranscriptionWithRetry(
            recordingId,
            event.text,
            mappedSegments,
            notebookId,
          );

          if (!saved) {
            // Update local state if server save failed after retries
            const current = this.recording();
            if (current) {
              this.recording.set({
                ...current,
                transcription: event.text,
                segments: mappedSegments,
              });
            }
          }
        }
      });
  }

  /**
   * Save transcription with retry logic (3 attempts with exponential backoff)
   */
  private async saveTranscriptionWithRetry(
    recordingId: string,
    text: string,
    segments: { text: string; start: number; end: number }[] | undefined,
    notebookId: string | undefined,
    maxRetries = 3,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const updatedRecording = await firstValueFrom(
          this.recordingService.saveTranscription(recordingId, text, segments, notebookId),
        );
        this.recording.set(updatedRecording);
        return true;
      } catch {
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
        }
      }
    }
    return false;
  }

  /**
   * Load recording from server by recordingId
   * Returns null if recording doesn't exist yet (expected for new embeds)
   */
  private async loadRecording(recordingId: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const recording = await firstValueFrom(this.recordingService.getRecording(recordingId));

      if (recording) {
        this.recording.set(recording);
        this.state.set(recording.state);
      } else {
        // Recording doesn't exist yet - show empty state (this is expected for new embeds)
        this.state.set('empty');
      }
    } catch (err: unknown) {
      // 404 means recording doesn't exist yet - this is expected for new embeds
      if (err && typeof err === 'object' && 'status' in err && err.status === 404) {
        this.state.set('empty');
      } else {
        this.error.set('Failed to load recording');
        this.state.set('failed');
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Start recording
   */
  async startRecording(): Promise<void> {
    const recordingId = this.recordingId();
    const notebookId = this.parentPageId() || undefined;
    this.error.set(null);
    this.state.set('recording');

    try {
      // Create recording on server first (notebookId enables WebSocket broadcasting)
      const recording = await firstValueFrom(
        this.recordingService.createRecording(recordingId, this.canUseNative(), notebookId),
      );
      this.recording.set(recording);

      // Start web or native recording
      if (this.canUseNative()) {
        this.recordingService.startNativeRecording(recordingId, this.includeSystemAudio());
      } else {
        await this.recordingService.startWebRecording(recordingId);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to start recording');
      this.state.set('failed');
    }
  }

  /**
   * Stop recording and upload
   */
  async stopRecording(): Promise<void> {
    const recordingId = this.recordingId();
    const notebookId = this.parentPageId() || undefined;
    this.state.set('uploading');

    try {
      if (this.canUseNative()) {
        // Native recording - wait for stop confirmation with audio data
        const result = await firstValueFrom(this.recordingService.stopNativeRecording());

        // If we have audio data, upload it to the server
        if (result.audioData) {
          // Convert base64 to Blob
          const binaryString = atob(result.audioData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const audioBlob = new Blob([bytes], { type: result.mimeType || 'audio/mp4' });

          // Upload to server
          const recording = await firstValueFrom(
            this.recordingService.uploadRecording(
              recordingId,
              audioBlob,
              result.duration,
              notebookId,
            ),
          );
          this.recording.set(recording);
          this.state.set('complete');
        } else {
          // No audio data - just update local state
          this.recording.set({
            ...(this.recording() || {}),
            id: recordingId,
            duration: result.duration,
            state: 'complete',
            audioUrl: undefined,
          } as Recording);
          this.state.set('complete');
        }
        // Transcription will be handled by the transcriptionComplete event listener
      } else {
        // Web recording returns blob
        const blob = await this.recordingService.stopWebRecording();
        if (blob) {
          const duration = this.recordingService.duration();

          // Upload audio (runs in parallel with transcription)
          const uploadPromise = firstValueFrom(
            this.recordingService.uploadRecording(recordingId, blob, duration, notebookId),
          );

          // Transcribe locally (runs in parallel with upload)
          const transcribePromise = this.whisperService.transcribe(blob);

          // Wait for upload first - user sees complete state sooner
          const recording = await uploadPromise;
          this.recording.set(recording);
          this.state.set('complete');

          // Then save transcription when ready (non-blocking)
          try {
            const { text, segments } = await transcribePromise;
            if (text) {
              await this.saveTranscriptionWithRetry(recordingId, text, segments, notebookId);
            }
          } catch (err) {
            // Transcription failed but recording saved - non-fatal
            console.warn('Local transcription failed:', err);
          }
        } else {
          throw new Error('No recording data');
        }
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save recording');
      this.state.set('failed');
    }
  }

  /**
   * Cancel recording without saving
   */
  cancelRecording(): void {
    if (this.canUseNative()) {
      this.recordingService.cancelNativeRecording();
    } else {
      this.recordingService.cancelWebRecording();
    }
    this.state.set('empty');
  }

  /**
   * Delete recording
   */
  async deleteRecording(): Promise<void> {
    const recordingId = this.recordingId();

    try {
      await firstValueFrom(this.recordingService.deleteRecording(recordingId));
      this.deleteRequested.emit(recordingId);
    } catch {
      this.error.set('Failed to delete recording');
    }
  }

  /**
   * Retry failed recording/upload
   */
  retry(): void {
    this.error.set(null);
    this.state.set('empty');
  }

  /**
   * Toggle system audio capture (macOS only)
   */
  toggleSystemAudio(): void {
    this.includeSystemAudio.update((v) => !v);
  }

  /**
   * Format duration for display
   */
  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

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

  constructor() {
    console.log('[RecordingEmbed] Component constructed');

    // Load recording when recordingId changes
    effect(() => {
      const id = this.recordingId();
      console.log('[RecordingEmbed] recordingId effect triggered:', id);
      if (id) {
        this.loadRecording(id);
      }
    });

    // Debug: log ownership info
    effect(() => {
      const currentUserId = this.authService.user()?._id;
      const creator = this.createdBy();
      const isOwner = this.isOwner();
      console.log('[RecordingEmbed] Ownership check:', {
        recordingId: this.recordingId(),
        currentUserId,
        createdBy: creator,
        isOwner,
        parentPageId: this.parentPageId(),
      });
    });

    // Subscribe to real-time recording events for non-owners
    this.realtimeWS
      .on('recording.started')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        console.log('[RecordingEmbed] Received recording.started event:', event);
        if (event.id === this.recordingId()) {
          console.log('[RecordingEmbed] Event matches this recording, isOwner:', this.isOwner());
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
        console.log('[RecordingEmbed] Received recording.completed event:', event);
        if (event.recording.id === this.recordingId()) {
          console.log('[RecordingEmbed] Event matches this recording');
          // Recording completed - update with full recording data
          this.recording.set(event.recording);
          this.state.set('complete');
        }
      });

    this.realtimeWS
      .on('recording.failed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        console.log('[RecordingEmbed] Received recording.failed event:', event);
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
        console.log('[RecordingEmbed] Native transcription complete:', event);
        // Only update if we're the active recording
        if (this.recordingService.activeRecordingId() === this.recordingId()) {
          const recordingId = this.recordingId();

          // Map native bridge segments to Recording schema format
          const mappedSegments = event.segments?.map((seg) => ({
            text: seg.text,
            start: seg.startTime,
            end: seg.endTime,
          }));

          // Save transcription to server
          try {
            const notebookId = this.parentPageId() || undefined;
            console.log('[RecordingEmbed] Saving transcription to server...', { notebookId });
            const updatedRecording = await firstValueFrom(
              this.recordingService.saveTranscription(
                recordingId,
                event.text,
                mappedSegments,
                notebookId,
              ),
            );
            console.log('[RecordingEmbed] Transcription saved:', updatedRecording);
            this.recording.set(updatedRecording);
          } catch (err) {
            console.error('[RecordingEmbed] Failed to save transcription:', err);
            // Still update local state even if server save fails
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

    console.log('[RecordingEmbed] startRecording:', {
      recordingId,
      notebookId,
      canUseNative: this.canUseNative(),
    });

    try {
      // Create recording on server first (notebookId enables WebSocket broadcasting)
      const recording = await firstValueFrom(
        this.recordingService.createRecording(recordingId, this.canUseNative(), notebookId),
      );
      console.log('[RecordingEmbed] Recording created:', recording);
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
        console.log('[RecordingEmbed] Native recording stopped, result:', {
          filePath: result.filePath,
          duration: result.duration,
          hasAudioData: !!result.audioData,
          audioDataLength: result.audioData?.length,
          mimeType: result.mimeType,
        });

        // If we have audio data, upload it to the server
        if (result.audioData) {
          console.log('[RecordingEmbed] Uploading native audio to server...');
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
          console.log('[RecordingEmbed] Native audio uploaded:', recording);
          this.recording.set(recording);
          this.state.set('complete');
        } else {
          // No audio data - just update local state
          console.log('[RecordingEmbed] No audio data from native, updating local state only');
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
          const recording = await firstValueFrom(
            this.recordingService.uploadRecording(recordingId, blob, duration, notebookId),
          );
          this.recording.set(recording);
          this.state.set('complete');
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

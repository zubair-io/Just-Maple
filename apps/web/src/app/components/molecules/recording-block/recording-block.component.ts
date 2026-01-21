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
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import type { Recording } from '@maple/shared';
import { firstValueFrom } from 'rxjs';

type RecordingBlockState = 'empty' | 'recording' | 'uploading' | 'complete' | 'failed';

@Component({
  selector: 'app-recording-block',
  standalone: true,
  imports: [CommonModule, AudioPlayerComponent],
  templateUrl: './recording-block.component.html',
  styleUrl: './recording-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingBlockComponent {
  private readonly recordingService = inject(RecordingService);
  private readonly destroyRef = inject(DestroyRef);

  readonly recordingId = input.required<string>();

  readonly deleteRequested = output<string>();

  // Local state
  readonly recording = signal<Recording | null>(null);
  readonly state = signal<RecordingBlockState>('empty');
  readonly error = signal<string | null>(null);
  readonly isLoading = signal(true);

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

  constructor() {
    // Load recording when recordingId changes
    effect(() => {
      const id = this.recordingId();
      if (id) {
        this.loadRecording(id);
      }
    });
  }

  /**
   * Load recording from server
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
        // Recording doesn't exist yet - show empty state
        this.state.set('empty');
      }
    } catch (err) {
      this.error.set('Failed to load recording');
      this.state.set('failed');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Start recording
   */
  async startRecording(): Promise<void> {
    const recordingId = this.recordingId();
    this.error.set(null);
    this.state.set('recording');

    try {
      // Create recording on server first
      const recording = await firstValueFrom(
        this.recordingService.createRecording(recordingId, this.canUseNative()),
      );
      this.recording.set(recording);

      // Start web or native recording
      if (this.canUseNative()) {
        this.recordingService.startNativeRecording(recordingId);
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
    this.state.set('uploading');

    try {
      if (this.canUseNative()) {
        // Native recording returns file path
        const result = await firstValueFrom(this.recordingService.stopNativeRecording());

        // For native, we need to read the file and upload it
        // This will be handled by the native bridge sending the data
        // For now, just update state
        this.state.set('complete');
        await this.loadRecording(recordingId);
      } else {
        // Web recording returns blob
        const blob = await this.recordingService.stopWebRecording();
        if (blob) {
          const duration = this.recordingService.duration();
          const recording = await firstValueFrom(
            this.recordingService.uploadRecording(recordingId, blob, duration),
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
    } catch (err) {
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
   * Format duration for display
   */
  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

import {
  Component,
  input,
  signal,
  computed,
  effect,
  ElementRef,
  ViewChild,
  DestroyRef,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

type PlaybackSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;

@Component({
  selector: 'app-audio-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioPlayerComponent {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('audioElement', { static: false })
  private audioRef?: ElementRef<HTMLAudioElement>;

  readonly audioUrl = input.required<string>();
  readonly duration = input<number>(0);

  // Playback state
  readonly isPlaying = signal(false);
  readonly currentTime = signal(0);
  readonly buffered = signal(0);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly playbackSpeed = signal<PlaybackSpeed>(1);

  // Progress percentage
  readonly progress = computed(() => {
    const dur = this.duration() || 1;
    return (this.currentTime() / dur) * 100;
  });

  // Buffered percentage
  readonly bufferedProgress = computed(() => {
    const dur = this.duration() || 1;
    return (this.buffered() / dur) * 100;
  });

  readonly availableSpeeds: PlaybackSpeed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

  private animationFrameId: number | null = null;

  constructor() {
    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopUpdateLoop();
    });

    // Update audio element when URL changes
    effect(() => {
      const url = this.audioUrl();
      if (url && this.audioRef?.nativeElement) {
        this.audioRef.nativeElement.src = url;
        this.audioRef.nativeElement.load();
      }
    });
  }

  /**
   * Handle audio element events
   */
  onLoadedMetadata(): void {
    this.isLoading.set(false);
  }

  onCanPlay(): void {
    this.isLoading.set(false);
  }

  onWaiting(): void {
    this.isLoading.set(true);
  }

  onPlaying(): void {
    this.isLoading.set(false);
    this.isPlaying.set(true);
    this.startUpdateLoop();
  }

  onPause(): void {
    this.isPlaying.set(false);
    this.stopUpdateLoop();
  }

  onEnded(): void {
    this.isPlaying.set(false);
    this.currentTime.set(0);
    this.stopUpdateLoop();
  }

  onError(): void {
    this.error.set('Failed to load audio');
    this.isLoading.set(false);
  }

  onProgress(): void {
    const audio = this.audioRef?.nativeElement;
    if (audio && audio.buffered.length > 0) {
      this.buffered.set(audio.buffered.end(audio.buffered.length - 1));
    }
  }

  /**
   * Toggle play/pause
   */
  togglePlay(): void {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    if (this.isPlaying()) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        this.error.set('Failed to play audio');
      });
    }
  }

  /**
   * Seek to position
   */
  seek(event: MouseEvent): void {
    const audio = this.audioRef?.nativeElement;
    const target = event.currentTarget as HTMLElement;
    if (!audio || !target) return;

    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percentage = x / rect.width;
    const dur = this.duration() || audio.duration || 0;

    audio.currentTime = percentage * dur;
    this.currentTime.set(audio.currentTime);
  }

  /**
   * Skip forward 10 seconds
   */
  skipForward(): void {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    const dur = this.duration() || audio.duration || 0;
    audio.currentTime = Math.min(audio.currentTime + 10, dur);
    this.currentTime.set(audio.currentTime);
  }

  /**
   * Skip backward 10 seconds
   */
  skipBackward(): void {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    audio.currentTime = Math.max(audio.currentTime - 10, 0);
    this.currentTime.set(audio.currentTime);
  }

  /**
   * Cycle through playback speeds
   */
  cycleSpeed(): void {
    const currentIndex = this.availableSpeeds.indexOf(this.playbackSpeed());
    const nextIndex = (currentIndex + 1) % this.availableSpeeds.length;
    const newSpeed = this.availableSpeeds[nextIndex];

    this.playbackSpeed.set(newSpeed);

    const audio = this.audioRef?.nativeElement;
    if (audio) {
      audio.playbackRate = newSpeed;
    }
  }

  /**
   * Format time for display
   */
  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Start the update loop for current time
   */
  private startUpdateLoop(): void {
    const updateTime = () => {
      const audio = this.audioRef?.nativeElement;
      if (audio && this.isPlaying()) {
        this.currentTime.set(audio.currentTime);
        this.animationFrameId = requestAnimationFrame(updateTime);
      }
    };
    updateTime();
  }

  /**
   * Stop the update loop
   */
  private stopUpdateLoop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

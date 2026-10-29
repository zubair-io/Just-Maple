import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Editor } from '@tiptap/core';
import { ReaderService } from '../../../services/reader.service';
import { TtsService } from '../../../services/tts.service';

@Component({
  selector: 'app-reader-controls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reader-controls.component.html',
  styleUrl: './reader-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReaderControlsComponent {
  readonly editor = input<Editor | null>(null);

  readonly reader = inject(ReaderService);
  readonly tts = inject(TtsService);

  readonly status = this.reader.status;
  readonly ttsStatus = this.tts.status;

  readonly label = computed(() => {
    const s = this.status();
    if (s === 'loading') {
      return this.ttsStatus() === 'loading' ? 'Loading voice…' : 'Preparing…';
    }
    if (s === 'playing') return 'Reading';
    if (s === 'paused') return 'Paused';
    return 'Read aloud';
  });

  play(): void {
    const ed = this.editor();
    if (!ed) return;
    void this.reader.start(ed);
  }

  pause(): void {
    this.reader.pause();
  }

  resume(): void {
    this.reader.resume();
  }

  stop(): void {
    this.reader.stop();
  }
}

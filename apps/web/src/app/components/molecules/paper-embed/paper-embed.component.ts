import { Component, input, ChangeDetectionStrategy, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RecordingEmbedComponent } from '../recording-embed/recording-embed.component';
import { WhiteboardEmbedComponent } from '../whiteboard-embed/whiteboard-embed.component';
import { MemoEmbedComponent } from '../memo-embed/memo-embed.component';

export type EmbedType = 'recording' | 'whiteboard' | 'memo';

@Component({
  selector: 'app-paper-embed',
  standalone: true,
  imports: [CommonModule, RecordingEmbedComponent, WhiteboardEmbedComponent, MemoEmbedComponent],
  templateUrl: './paper-embed.component.html',
  styleUrl: './paper-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperEmbedComponent {
  /** The ID of the embedded entity (recordingId, whiteboardId, etc.) */
  readonly embedId = input.required<string>();

  /** The type of embed to render */
  readonly embedType = input.required<EmbedType>();

  /** The user ID who created this embed (for ownership tracking) */
  readonly createdBy = input<string | null>(null);

  /** The ID of the parent memo/page containing this embed (for WebSocket broadcasting) */
  readonly parentPageId = input<string | null>(null);

  /** Emitted when delete is requested */
  readonly deleteRequested = output<string>();

  /**
   * Handle delete request from child component
   */
  onDeleteRequested(): void {
    this.deleteRequested.emit(this.embedId());
  }
}

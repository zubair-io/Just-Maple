import { Component, input, ChangeDetectionStrategy, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WhiteboardComponent } from '@maple/whiteboard';

@Component({
  selector: 'app-whiteboard-embed',
  standalone: true,
  imports: [CommonModule, WhiteboardComponent],
  templateUrl: './whiteboard-embed.component.html',
  styleUrl: './whiteboard-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhiteboardEmbedComponent {
  readonly documentId = input.required<string>();

  /** Parent memo's pageId for authorization */
  readonly parentPageId = input<string | null>(null);

  readonly deleteRequested = output<string>();

  /**
   * Handle delete request
   */
  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteRequested.emit(this.documentId());
  }
}

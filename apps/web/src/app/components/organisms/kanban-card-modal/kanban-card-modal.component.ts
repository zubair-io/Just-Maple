import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotebookEditorComponent } from '../notebook-editor/notebook-editor.component';

@Component({
  selector: 'app-kanban-card-modal',
  standalone: true,
  imports: [CommonModule, NotebookEditorComponent],
  templateUrl: './kanban-card-modal.component.html',
  styleUrl: './kanban-card-modal.component.scss',
})
export class KanbanCardModalComponent {
  readonly pageId = input.required<string>();
  readonly notebookId = input.required<string>();
  readonly cardTitle = input<string>('');

  readonly closed = output<void>();
  readonly titleChanged = output<string>();
  readonly tagsChanged = output<string[]>();
  readonly mentionsChanged = output<{ userId: string; displayName: string }[]>();

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}

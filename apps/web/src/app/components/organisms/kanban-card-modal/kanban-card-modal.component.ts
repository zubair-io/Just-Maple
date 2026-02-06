import { Component, input, output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotebookEditorComponent } from '../notebook-editor/notebook-editor.component';
import { PageService } from '../../../services/page.service';

@Component({
  selector: 'app-kanban-card-modal',
  standalone: true,
  imports: [CommonModule, NotebookEditorComponent],
  templateUrl: './kanban-card-modal.component.html',
  styleUrl: './kanban-card-modal.component.scss',
})
export class KanbanCardModalComponent {
  private readonly pageService = inject(PageService);

  readonly pageId = input.required<string>();
  readonly notebookId = input.required<string>();
  readonly cardTitle = input<string>('');

  readonly closed = output<void>();

  readonly displayTitle = computed(() => {
    const page = this.pageService.getPageById(this.pageId());
    return page?.title || this.cardTitle() || 'Untitled';
  });

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

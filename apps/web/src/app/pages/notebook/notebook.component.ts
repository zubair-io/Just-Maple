import { Component, inject, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { NoteService } from '../../services/note.service';
import { TagService } from '../../services/tag.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotebookEditorComponent } from '../../components/organisms/notebook-editor/notebook-editor.component';
import { NoteHeaderComponent } from '../../components';

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule, NotebookEditorComponent, NoteHeaderComponent],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
})
export class NotebookComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly noteService = inject(NoteService);
  private readonly tagService = inject(TagService);
  private readonly uiStateService = inject(UiStateService);

  private routeSubscription?: Subscription;

  readonly documentId = signal<string | null>(null);
  readonly tagId = signal<string | null>(null);

  // Get the note from the store
  readonly selectedNote = toSignal(this.noteService.activeNote$, { initialValue: null });

  // Get the tag for the selected note
  readonly selectedTag = toSignal(this.tagService.activeTag$, { initialValue: null });

  constructor() {
    // Subscribe to route params
    this.routeSubscription = this.route.params.subscribe((params) => {
      const documentId = params['documentId'] || null;
      const tagId = params['tagId'] || null;
      this.documentId.set(documentId);
      this.tagId.set(tagId);

      if (documentId) {
        this.noteService.setActiveNoteId(documentId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  toggleFavorite(): void {
    const note = this.selectedNote();
    if (!note?._id) return;

    this.noteService.toggleFavorite(note._id).subscribe({
      error: (error) => {
        console.error('Failed to toggle favorite:', error);
      },
    });
  }

  openSidebarOnMobile(): void {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.uiStateService.openSidebar();
    }
  }
}

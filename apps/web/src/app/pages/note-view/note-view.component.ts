import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { NoteEditorComponent, NoteHeaderComponent } from '../../components';

@Component({
  selector: 'app-note-view',
  standalone: true,
  imports: [CommonModule, NoteEditorComponent, NoteHeaderComponent],
  templateUrl: './note-view.component.html',
  styleUrl: './note-view.component.scss',
})
export class NoteViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);

  private routeSubscription?: Subscription;

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedTagId = signal<string | null>(null);

  // Computed signals reactively derive from store - no validation needed
  readonly selectedNote = computed(() => {
    const id = this.selectedNoteId();
    if (!id) return null;
    return this.noteService.notes().find((n) => n._id === id) || null;
  });

  readonly selectedTag = computed(() => {
    const tagId = this.selectedTagId();
    if (tagId) {
      return this.tagService.tags().find((t) => t._id === tagId) || null;
    }
    const note = this.selectedNote();
    if (note?.tagId) {
      return this.tagService.tags().find((t) => t._id === note.tagId) || null;
    }
    return null;
  });

  ngOnInit(): void {
    // Subscribe to route params and set IDs directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedTagId.set(params['tagId'] || null);

      // Read docUrl from route params and find note by docUrl
      const docUrl = params['docUrl'];
      if (docUrl) {
        // Find note by docUrl and set selectedNoteId to the note's _id
        const note = this.noteService.notes().find((n) => n.docUrl === docUrl);
        this.selectedNoteId.set(note?._id || null);
      } else {
        this.selectedNoteId.set(null);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  toggleFavorite(): void {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    this.noteService.toggleFavorite(noteId).subscribe({
      error: (error) => {
        console.error('Failed to toggle favorite:', error);
      },
    });
  }
}

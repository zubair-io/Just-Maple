import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { NoteEditorComponent } from '../../components';
import { DEFAULT_NOTE_CONTENT } from '@maple/shared';

@Component({
  selector: 'app-note-view',
  standalone: true,
  imports: [CommonModule, NoteEditorComponent],
  templateUrl: './note-view.component.html',
  styleUrl: './note-view.component.scss',
})
export class NoteViewComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
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

  readonly formattedDate = computed(() => {
    const note = this.selectedNote();
    if (!note?.updatedAt) return '';
    return this.formatDateValue(note.updatedAt);
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

  createNote(): void {
    const tagId = this.selectedTagId();

    this.noteService
      .createNote({
        title: 'Untitled',
        content: DEFAULT_NOTE_CONTENT,
        tagId: tagId || undefined,
      })
      .subscribe({
        next: (note) => {
          this.selectedNoteId.set(note._id);
          const urlParam = note.docUrl || note._id;
          if (tagId) {
            this.router.navigate(['/', tagId, urlParam]);
          }
        },
        error: (error) => {
          console.error('Failed to create note:', error);
        },
      });
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

  private formatDateValue(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }
}

import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { NoteEditorComponent, ChatComponent } from '../../components';
import { type NoteContent, DEFAULT_NOTE_CONTENT } from '@maple/shared';

/** Extract title text from the first H1 heading in content */
function extractTitleFromContent(content: NoteContent): string {
    const firstNode = content.content?.[0];
    if (firstNode?.type === 'heading' && firstNode.attrs?.level === 1) {
        // Get text from the heading's content array
        const textNode = firstNode.content?.[0];
        return textNode?.text || 'Untitled';
    }
    return 'Untitled';
}

@Component({
  selector: 'app-note-view',
  standalone: true,
  imports: [CommonModule, NoteEditorComponent, ChatComponent],
  templateUrl: './note-view.component.html',
  styleUrl: './note-view.component.scss',
})
export class NoteViewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedTagId = signal<string | null>(null);

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

  /** Cached formatted date to avoid ExpressionChangedAfterItHasBeenCheckedError */
  readonly formattedDate = computed(() => {
    const note = this.selectedNote();
    if (!note?.updatedAt) return '';
    return this.formatDateValue(note.updatedAt);
  });

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const tags = this.tagService.tags();
      const notes = this.noteService.notes();

      // Re-sync when data changes (tags or notes loaded/updated)
      if (tags.length === 0) return; // Need at least tags to be loaded

      this.syncFromRoute();
    });
  }

  ngOnInit(): void {
    // Re-sync when route params change
    this.route.params.subscribe(() => {
      this.syncFromRoute();
    });
  }

  private syncFromRoute(): void {
    const tagId = this.route.snapshot.params['tagId'];
    const noteId = this.route.snapshot.params['noteId'];

    if (tagId) {
      const tag = this.tagService.tags().find((t) => t._id === tagId);
      if (tag) {
        this.selectedTagId.set(tagId);

        if (noteId) {
          const note = this.noteService.notes().find((n) => n._id === noteId);
          if (note) {
            this.selectedNoteId.set(noteId);
          }
        } else {
          this.selectedNoteId.set(null);
        }
      }
    } else {
      this.selectedTagId.set(null);
      this.selectedNoteId.set(null);
    }
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
          if (tagId) {
            this.router.navigate(['/', tagId, note._id]);
          } else {
            this.router.navigate(['/']);
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

  onContentChange(content: NoteContent): void {
    // Extract title from H1 and save both
    const title = extractTitleFromContent(content);
    this.debouncedSave({ content, title });
  }

  private debouncedSave(data: { title?: string; content?: NoteContent }): void {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.noteService.updateNote(noteId, data).subscribe({
        error: (error) => {
          console.error('Failed to save note:', error);
        },
      });
    }, 500);
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

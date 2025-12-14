import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { NoteEditorComponent } from '../../components';
import type { NoteContent } from '@maple/shared';

@Component({
  selector: 'app-note-view',
  standalone: true,
  imports: [CommonModule, NoteEditorComponent],
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
    const note = this.selectedNote();
    if (note?.tagId) {
      return this.tagService.tags().find((t) => t._id === note.tagId) || null;
    }
    const tagId = this.selectedTagId();
    if (!tagId) return null;
    return this.tagService.tags().find((t) => t._id === tagId) || null;
  });

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  constructor() {
    effect(() => {
      const tags = this.tagService.tags();
      const notes = this.noteService.notes();

      if (tags.length === 0 && notes.length === 0) return;
      if (this.initialized) return;

      this.initialized = true;
      this.syncFromRoute();
    });
  }

  ngOnInit(): void {
    this.route.params.subscribe(() => {
      if (this.initialized) {
        this.syncFromRoute();
      }
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
        }
      }
    }
  }

  async createNote(): Promise<void> {
    try {
      const tagId = this.selectedTagId();
      const note = await this.noteService.createNote({
        title: 'Untitled',
        tagId: tagId || undefined,
      });
      this.selectedNoteId.set(note._id);

      if (tagId) {
        this.router.navigate(['/', tagId, note._id]);
      } else {
        this.router.navigate(['/']);
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  }

  async toggleFavorite(): Promise<void> {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    try {
      await this.noteService.toggleFavorite(noteId);
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  }

  onTitleChange(title: string): void {
    this.debouncedSave({ title });
  }

  onContentChange(content: string): void {
    const prosemirrorContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: content ? [{ type: 'text', text: content }] : [],
        },
      ],
    };
    this.debouncedSave({ content: prosemirrorContent });
  }

  private debouncedSave(data: { title?: string; content?: NoteContent }): void {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      try {
        await this.noteService.updateNote(noteId, data);
      } catch (error) {
        console.error('Failed to save note:', error);
      }
    }, 500);
  }

  formatDate(dateString: string): string {
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

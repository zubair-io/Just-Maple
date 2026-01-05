import { Component, input, output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import type { Note, Tag } from '@maple/shared';
import { DEFAULT_NOTE_CONTENT } from '@maple/shared';
import { NoteService } from '../../../services/note.service';

@Component({
  selector: 'app-note-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './note-header.component.html',
  styleUrl: './note-header.component.scss',
})
export class NoteHeaderComponent {
  private readonly noteService = inject(NoteService);
  private readonly router = inject(Router);

  readonly note = input<Note | null>(null);
  readonly tag = input<Tag | null>(null);

  readonly toggleFavorite = output<void>();

  readonly formattedDate = computed(() => {
    const note = this.note();
    if (!note?.updatedAt) return '';
    return this.formatDateValue(note.updatedAt);
  });

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

  createNote(): void {
    const tagId = this.tag()?._id;

    this.noteService
      .createNote({
        title: 'Untitled',
        content: DEFAULT_NOTE_CONTENT,
        tagId: tagId || undefined,
      })
      .subscribe({
        next: (note) => {
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
}

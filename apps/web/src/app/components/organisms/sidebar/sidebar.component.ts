import { Component, inject, signal, output, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { TagService } from '../../../services/tag.service';
import { NoteService } from '../../../services/note.service';
import type { Note } from '@maple/shared';

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './sidebar.component.html',
    styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
    private readonly router = inject(Router);
    readonly authService = inject(AuthService);
    readonly tagService = inject(TagService);
    readonly noteService = inject(NoteService);

    readonly selectedTagId = input<string | null>(null);
    readonly selectedNoteId = input<string | null>(null);

    readonly newNote = output<void>();
    readonly selectNote = output<string>();
    readonly selectTag = output<string>();
    readonly createTag = output<void>();
    readonly settings = output<void>();

    readonly searchQuery = signal('');
    readonly expandedTags = signal<Set<string>>(new Set());

    constructor() {
        // Auto-expand tag when selectedTagId changes
        effect(() => {
            const tagId = this.selectedTagId();
            if (tagId) {
                this.expandedTags.update((tags) => {
                    const newTags = new Set(tags);
                    newTags.add(tagId);
                    return newTags;
                });
            }
        });
    }

    get userInitials(): () => string {
        return () => {
            const user = this.authService.user();
            if (!user) return '?';
            const email = user.email;
            const name = user.displayName || email.split('@')[0];
            return name.slice(0, 2).toUpperCase();
        };
    }

    get userName(): () => string {
        return () => {
            const user = this.authService.user();
            if (!user) return 'Guest';
            return user.displayName || user.email.split('@')[0];
        };
    }

    toggleTag(tagId: string): void {
        this.expandedTags.update((tags) => {
            const newTags = new Set(tags);
            if (newTags.has(tagId)) {
                newTags.delete(tagId);
            } else {
                newTags.add(tagId);
            }
            return newTags;
        });
        this.selectTag.emit(tagId);
        this.router.navigate(['/', tagId]);
    }

    getNotesForTag(tagId: string): Note[] {
        return this.noteService.notes().filter((n) => n.tagId === tagId);
    }

    onNewNote(): void {
        this.newNote.emit();
    }

    onSelectNote(noteId: string, tagId: string): void {
        this.selectNote.emit(noteId);
        this.router.navigate(['/', tagId, noteId]);
    }

    onCreateTag(): void {
        this.createTag.emit();
    }

    onSettings(): void {
        this.settings.emit();
    }
}

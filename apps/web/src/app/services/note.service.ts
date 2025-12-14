import { Injectable, signal, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Note, CreateNoteInput, UpdateNoteInput } from '@maple/shared';

export interface NoteFilters {
  tagId?: string;
  favorites?: boolean;
  trash?: boolean;
  archived?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class NoteService {
  private readonly http = inject(HttpClient);

  private readonly _notes = signal<Note[]>([]);
  private readonly _selectedNoteId = signal<string | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly notes = this._notes.asReadonly();
  readonly selectedNoteId = this._selectedNoteId.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly selectedNote = computed(() => {
    const id = this._selectedNoteId();
    if (!id) return null;
    return this._notes().find((n) => n._id === id) || null;
  });

  async loadNotes(filters?: NoteFilters): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const params: Record<string, string> = {};
      if (filters?.tagId) params['tagId'] = filters.tagId;
      if (filters?.favorites) params['favorites'] = 'true';
      if (filters?.trash) params['trash'] = 'true';
      if (filters?.archived) params['archived'] = 'true';

      const response = await firstValueFrom(
        this.http.get<{ notes: Note[] }>('/api/notes', { params }),
      );
      this._notes.set(response.notes);
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to load notes';
      this._error.set(message);
      this._notes.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  async loadNote(id: string): Promise<Note | null> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(this.http.get<{ note: Note }>(`/api/notes/${id}`));

      // Update in local state if exists, otherwise add
      this._notes.update((notes) => {
        const exists = notes.some((n) => n._id === id);
        if (exists) {
          return notes.map((n) => (n._id === id ? response.note : n));
        }
        return [...notes, response.note];
      });

      return response.note;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to load note';
      this._error.set(message);
      return null;
    } finally {
      this._isLoading.set(false);
    }
  }

  async createNote(data: CreateNoteInput = {}): Promise<Note> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(this.http.post<{ note: Note }>('/api/notes', data));

      // Add to local state
      this._notes.update((notes) => [response.note, ...notes]);

      return response.note;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to create note';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async updateNote(id: string, data: UpdateNoteInput): Promise<Note> {
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.put<{ note: Note }>(`/api/notes/${id}`, data),
      );

      // Update local state
      this._notes.update((notes) => notes.map((n) => (n._id === id ? response.note : n)));

      return response.note;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to update note';
      this._error.set(message);
      throw new Error(message);
    }
  }

  async moveToTrash(id: string): Promise<void> {
    this._error.set(null);

    try {
      await firstValueFrom(this.http.post(`/api/notes/${id}/trash`, {}));

      // Remove from local state (since we're showing non-trashed by default)
      this._notes.update((notes) => notes.filter((n) => n._id !== id));

      // Clear selection if this was selected
      if (this._selectedNoteId() === id) {
        this._selectedNoteId.set(null);
      }
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to move note to trash';
      this._error.set(message);
      throw new Error(message);
    }
  }

  async restoreFromTrash(id: string): Promise<void> {
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<{ note: Note }>(`/api/notes/${id}/restore`, {}),
      );

      // Update local state
      this._notes.update((notes) => notes.map((n) => (n._id === id ? response.note : n)));
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to restore note';
      this._error.set(message);
      throw new Error(message);
    }
  }

  async deleteNote(id: string): Promise<void> {
    this._error.set(null);

    try {
      await firstValueFrom(this.http.delete(`/api/notes/${id}`));

      // Remove from local state
      this._notes.update((notes) => notes.filter((n) => n._id !== id));

      // Clear selection if this was selected
      if (this._selectedNoteId() === id) {
        this._selectedNoteId.set(null);
      }
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to delete note';
      this._error.set(message);
      throw new Error(message);
    }
  }

  async emptyTrash(): Promise<number> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.delete<{ count: number }>('/api/notes/trash/empty'),
      );

      // Clear all trashed notes from local state
      this._notes.update((notes) => notes.filter((n) => !n.isTrashed));

      return response.count;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to empty trash';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async toggleFavorite(id: string): Promise<void> {
    const note = this._notes().find((n) => n._id === id);
    if (!note) return;

    await this.updateNote(id, { isFavorite: !note.isFavorite });
  }

  selectNote(id: string | null): void {
    this._selectedNoteId.set(id);
  }

  getNoteById(id: string): Note | undefined {
    return this._notes().find((n) => n._id === id);
  }

  getNotesForTag(tagId: string): Note[] {
    return this._notes().filter((n) => n.tagId === tagId);
  }
}

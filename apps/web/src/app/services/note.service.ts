import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of, switchMap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore } from '@ngneat/elf';
import {
    withEntities,
    withActiveId,
    selectAllEntities,
    selectActiveEntity,
    selectEntity,
    setEntities,
    addEntities,
    updateEntities,
    deleteEntities,
    upsertEntities,
    setActiveId,
    resetActiveId,
    getEntity,
    getAllEntities,
    getEntitiesCount,
    getActiveEntity,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import type { Note, CreateNoteInput, UpdateNoteInput, NoteContent, DEFAULT_NOTE_CONTENT } from '@maple/shared';

const STORE_NAME = DB_STORES.NOTE;

export interface NoteFilters {
    tagId?: string;
    favorites?: boolean;
    trash?: boolean;
    archived?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NoteService {
    private readonly http = inject(HttpClient);
    private readonly indexedDB = inject(IndexedDBService);
    private readonly platformId = inject(PLATFORM_ID);

    // ELF Store
    private readonly store = createStore(
        { name: STORE_NAME },
        withEntities<Note, '_id'>({ idKey: '_id' }),
        withActiveId(),
    );

    // Observable selectors
    readonly notes$ = this.store.pipe(selectAllEntities());
    readonly activeNote$ = this.store.pipe(selectActiveEntity());

    // Signal wrappers for Angular reactivity
    private readonly _notesSignal = toSignal(this.notes$, { initialValue: [] as Note[] });

    // UI state signals
    private readonly _isLoading = signal(false);
    private readonly _error = signal<string | null>(null);

    readonly isLoading = this._isLoading.asReadonly();
    readonly error = this._error.asReadonly();

    constructor() {
        if (isPlatformBrowser(this.platformId)) {
            this.hydrateFromIndexedDB();
        }
    }

    private async hydrateFromIndexedDB(): Promise<void> {
        const cached = await this.indexedDB.getAll<Note>(STORE_NAME);
        if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
            this.store.update(setEntities(cached));
        }
    }

    /**
     * Get all notes as a reactive signal
     */
    notes(): Note[] {
        return this._notesSignal() ?? [];
    }

    /**
     * Get selected note ID synchronously
     */
    selectedNoteId(): string | null {
        const active = this.store.query(getActiveEntity());
        return active?._id || null;
    }

    /**
     * Get selected note synchronously
     */
    selectedNote(): Note | null {
        return this.store.query(getActiveEntity()) || null;
    }

    /**
     * Load notes from API with optional filters
     */
    loadNotes(filters?: NoteFilters): Observable<Note[]> {
        this._isLoading.set(true);
        this._error.set(null);

        const params: Record<string, string> = {};
        if (filters?.tagId) params['tagId'] = filters.tagId;
        if (filters?.favorites) params['favorites'] = 'true';
        if (filters?.trash) params['trash'] = 'true';
        if (filters?.archived) params['archived'] = 'true';

        return this.http.get<{ notes: Note[] }>('/api/notes', { params }).pipe(
            tap((response) => {
                this.store.update(setEntities(response.notes));
                this.persistToIndexedDB(response.notes);
                this._isLoading.set(false);
            }),
            map((response) => response.notes),
            catchError((err) => {
                const message = err?.error?.error || 'Failed to load notes';
                this._error.set(message);
                this._isLoading.set(false);
                return of([]);
            }),
        );
    }

    /**
     * Load a single note by ID
     */
    loadNote(id: string): Observable<Note | null> {
        const cached = this.store.query(getEntity(id));
        if (cached) {
            return of(cached);
        }

        this._isLoading.set(true);
        this._error.set(null);

        return this.http.get<{ note: Note }>(`/api/notes/${id}`).pipe(
            tap((response) => {
                this.store.update(upsertEntities([response.note]));
                this.persistToIndexedDB([response.note]);
                this._isLoading.set(false);
            }),
            map((response) => response.note),
            catchError((err) => {
                const message = err?.error?.error || 'Failed to load note';
                this._error.set(message);
                this._isLoading.set(false);
                return of(null);
            }),
        );
    }

    /**
     * Create a new note with optimistic update
     */
    createNote(data: CreateNoteInput = {}): Observable<Note> {
        this._isLoading.set(true);
        this._error.set(null);

        const tempId = `temp-${Date.now()}`;
        const now = new Date().toISOString();
        const defaultContent: NoteContent = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
        };

        const tempNote: Note = {
            _id: tempId,
            userId: 'temp',
            title: data.title || 'Untitled',
            content: data.content || defaultContent,
            version: 1,
            tagId: data.tagId,
            isFavorite: false,
            isArchived: false,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
        };

        this.store.update(addEntities(tempNote));

        return this.http.post<{ note: Note }>('/api/notes', data).pipe(
            tap((response) => {
                this.store.update(deleteEntities(tempId));
                this.store.update(addEntities(response.note));
                this.persistToIndexedDB([response.note]);
                this._isLoading.set(false);
            }),
            map((response) => response.note),
            catchError((err) => {
                this.store.update(deleteEntities(tempId));
                const message = err?.error?.error || 'Failed to create note';
                this._error.set(message);
                this._isLoading.set(false);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Update a note with optimistic update
     */
    updateNote(id: string, data: UpdateNoteInput): Observable<Note> {
        this._error.set(null);

        const original = this.store.query(getEntity(id));
        if (!original) {
            return throwError(() => new Error('Note not found'));
        }

        // Optimistic update
        this.store.update(
            updateEntities(id, (entity) => ({
                ...entity,
                ...data,
                version: (entity.version || 0) + 1,
                updatedAt: new Date().toISOString(),
            })),
        );

        return this.http.put<{ note: Note }>(`/api/notes/${id}`, data).pipe(
            tap((response) => {
                this.store.update(updateEntities(id, () => response.note));
                this.persistToIndexedDB([response.note]);
            }),
            map((response) => response.note),
            catchError((err) => {
                this.store.update(updateEntities(id, () => original));
                const message = err?.error?.error || 'Failed to update note';
                this._error.set(message);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Move note to trash
     */
    moveToTrash(id: string): Observable<void> {
        this._error.set(null);

        const original = this.store.query(getEntity(id));
        if (!original) {
            return throwError(() => new Error('Note not found'));
        }

        const wasActive = this.selectedNoteId() === id;

        // Optimistic update - remove from visible list
        this.store.update(deleteEntities(id));
        if (wasActive) {
            this.store.update(resetActiveId());
        }

        return this.http.post(`/api/notes/${id}/trash`, {}).pipe(
            tap(() => {
                if (isPlatformBrowser(this.platformId)) {
                    this.indexedDB.delete(id, STORE_NAME);
                }
            }),
            map(() => undefined),
            catchError((err) => {
                this.store.update(addEntities(original));
                if (wasActive) {
                    this.store.update(setActiveId(id));
                }
                const message = err?.error?.error || 'Failed to move note to trash';
                this._error.set(message);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Restore note from trash
     */
    restoreFromTrash(id: string): Observable<Note> {
        this._error.set(null);

        return this.http.post<{ note: Note }>(`/api/notes/${id}/restore`, {}).pipe(
            tap((response) => {
                this.store.update(upsertEntities([response.note]));
                this.persistToIndexedDB([response.note]);
            }),
            map((response) => response.note),
            catchError((err) => {
                const message = err?.error?.error || 'Failed to restore note';
                this._error.set(message);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Permanently delete a note
     */
    deleteNote(id: string): Observable<void> {
        this._error.set(null);

        const original = this.store.query(getEntity(id));
        const wasActive = this.selectedNoteId() === id;

        this.store.update(deleteEntities(id));
        if (wasActive) {
            this.store.update(resetActiveId());
        }

        return this.http.delete(`/api/notes/${id}`).pipe(
            tap(() => {
                if (isPlatformBrowser(this.platformId)) {
                    this.indexedDB.delete(id, STORE_NAME);
                }
            }),
            map(() => undefined),
            catchError((err) => {
                if (original) {
                    this.store.update(addEntities(original));
                    if (wasActive) {
                        this.store.update(setActiveId(id));
                    }
                }
                const message = err?.error?.error || 'Failed to delete note';
                this._error.set(message);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Empty trash - delete all trashed notes
     */
    emptyTrash(): Observable<number> {
        this._isLoading.set(true);
        this._error.set(null);

        return this.http.delete<{ count: number }>('/api/notes/trash/empty').pipe(
            tap((response) => {
                // Remove all trashed notes from store
                const allNotes = this.notes();
                const nonTrashedNotes = allNotes.filter((n) => !n.isTrashed);
                this.store.update(setEntities(nonTrashedNotes));
                this._isLoading.set(false);
            }),
            map((response) => response.count),
            catchError((err) => {
                const message = err?.error?.error || 'Failed to empty trash';
                this._error.set(message);
                this._isLoading.set(false);
                return throwError(() => new Error(message));
            }),
        );
    }

    /**
     * Toggle favorite status
     */
    toggleFavorite(id: string): Observable<Note> {
        const note = this.store.query(getEntity(id));
        if (!note) {
            return throwError(() => new Error('Note not found'));
        }

        return this.updateNote(id, { isFavorite: !note.isFavorite });
    }

    /**
     * Select a note as active
     */
    selectNote(id: string | null): void {
        if (id) {
            this.store.update(setActiveId(id));
        } else {
            this.store.update(resetActiveId());
        }
    }

    /**
     * Get note by ID synchronously
     */
    getNoteById(id: string): Note | undefined {
        return this.store.query(getEntity(id));
    }

    /**
     * Get notes for a specific tag
     */
    getNotesForTag(tagId: string): Note[] {
        return this.store.query(getAllEntities()).filter((n) => n.tagId === tagId);
    }

    /**
     * Select a single note as observable
     */
    select(id: string): Observable<Note | undefined> {
        return this.store.pipe(selectEntity(id));
    }

    /**
     * Clear cache
     */
    async clearCache(): Promise<void> {
        this.store.update(setEntities([]));
        this.store.update(resetActiveId());

        if (isPlatformBrowser(this.platformId)) {
            await this.indexedDB.clear(STORE_NAME);
        }
    }

    private async persistToIndexedDB(notes: Note[]): Promise<void> {
        if (!isPlatformBrowser(this.platformId) || notes.length === 0) return;
        await this.indexedDB.putMany(notes, STORE_NAME);
    }
}

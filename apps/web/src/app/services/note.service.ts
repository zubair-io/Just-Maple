import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  tap,
  map,
  catchError,
  throwError,
  of,
  switchMap,
  startWith,
  concat,
  groupBy,
  mergeMap,
  debounceTime,
  Subject,
} from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore, filterNil, select } from '@ngneat/elf';
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
  selectActiveId,
  selectManyByPredicate,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { NetworkService } from './network.service';
import { DB_STORES } from './db-stores';
import type {
  Note,
  CreateNoteInput,
  UpdateNoteInput,
  NoteContent,
  DEFAULT_NOTE_CONTENT,
} from '@maple/shared';

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
  private readonly network = inject(NetworkService);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Note, 'documentId'>({ idKey: 'documentId' }),
    withActiveId(),
  );

  // Observable selectors
  readonly notes$ = this.store.pipe(selectAllEntities());
  readonly activeNote$: Observable<Note> = this.store.pipe(selectActiveEntity(), filterNil());
  readonly activeId$ = this.store.pipe(selectActiveId());

  // Signal wrappers for Angular reactivity
  private readonly _notesSignal = toSignal(this.notes$, { initialValue: [] as Note[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // Subject to queue save requests
  private readonly saveSubject = new Subject<{ id: string; base64Data: string }>();

  constructor() {
    console.log('[NoteService] Initialized');
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
    }
    this.setupSaveSubscription();
  }

  private setupSaveSubscription() {
    this.saveSubject
      .pipe(
        // Group saves by note ID so one note doesn't block another
        groupBy((req) => req.id),
        // For each group (each note ID), debounce
        mergeMap((group) =>
          group.pipe(
            debounceTime(1000), // Wait 1 second of silence
            switchMap((req) => {
              console.log('[NoteService] Processing debounced save for', req.id);
              return this.http
                .put<{ note: Note }>(`/api/notes/${req.id}`, { automergeDoc: req.base64Data })
                .pipe(
                  tap(() => console.log('[NoteService] Synced automerge doc to server', req.id)),
                  catchError((err) => {
                    console.error('[NoteService] Failed to sync automerge doc', err);
                    return of(null);
                  }),
                );
            }),
          ),
        ),
      )
      .subscribe();
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Note>(STORE_NAME);
    // console.log(cached);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }
  setActiveNoteId(id: string | null): void {
    this.store.update(setActiveId(id));
  }

  /**
   * Get all notes as a reactive signal
   */
  notes(): Note[] {
    return this._notesSignal() ?? [];
  }
  notesByTag$(tagId: string): Observable<Note[]> {
    return this.store.pipe(selectManyByPredicate((entity) => entity.tagId === tagId));
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
        // console.log('[NoteService] Loaded notes from server:', response.notes);
        this.store.update(setEntities(response.notes));
        this.persistToIndexedDB(response.notes);
        this._isLoading.set(false);
      }),
      map((response) => response.notes),
      catchError((err) => {
        let message = err?.error?.error || 'Failed to load notes';

        // Network-aware error message
        if (!this.network.isOnline()) {
          message = 'Working offline - showing cached data';
        }

        this._error.set(message);
        this._isLoading.set(false);

        // Return cached data instead of empty array
        const cached = this.store.query(getAllEntities());
        return of(cached);
      }),
    );
  }

  /**
   * Get a single note by ID from server
   */
  getNote(noteId: string): Observable<Note> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ note: Note }>(`/api/notes/${noteId}`).pipe(
      tap((response) => {
        this.store.update(upsertEntities(response.note));
        this.persistToIndexedDB([response.note]);
        this._isLoading.set(false);
      }),
      map((response) => response.note),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to fetch note';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => err);
      }),
    );
  }

  /**
   * Create a new note with optimistic update
   */
  createNote(data: CreateNoteInput): Observable<Note> {
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
      type: data.type || 'write',
      title: data.title || 'Untitled',
      content: data.content || defaultContent,
      documentId: data.documentId || tempId,
      version: 1,
      tagId: data.tagId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    this.store.update(addEntities(tempNote));

    return concat(
      of(tempNote),
      this.http.post<{ note: Note }>('/api/notes', data).pipe(
        tap((response) => {
          console.log('Created note:', response.note);

          this.store.update(updateEntities(response.note.documentId, response.note));
          this.persistToIndexedDB([response.note]);
          this._isLoading.set(false);
        }),
        map((response) => response.note),
      ),
    );
  }

  /**
   * Update a note with optimistic update
   */
  updateNote(id: string, data: UpdateNoteInput): Observable<Note> {
    this._error.set(null);
    // console.log('[NoteService] Updating note', id, data);
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
   * Save Automerge document
   * - Updates local store/IndexedDB immediately
   * - Triggers debounced background API sync
   */
  async saveAutomergeDoc(id: string, base64Data: string): Promise<void> {
    const original = this.store.query(getEntity(id));
    if (!original) return;

    // 1. Optimistic local update (this happens immediately on every keystroke/save)
    const updatedNote: Note = {
      ...original,
      automergeDoc: base64Data, // Store as base64 string locally
      updatedAt: new Date().toISOString(),
    };

    // console.log('[NoteService] Saving automerge doc locally', id);
    this.store.update(updateEntities(id, updatedNote));
    await this.persistToIndexedDB([updatedNote]);

    // 2. Queue sync to server via Subject
    this.saveSubject.next({ id, base64Data });
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

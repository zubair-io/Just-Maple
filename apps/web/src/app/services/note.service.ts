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
  merge,
  takeWhile,
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
import { RealtimeWSService, type AppEvent } from './realtime-ws.service';
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
  private readonly realtimeWS = inject(RealtimeWSService);
  private init = false;

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
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
    }

    this.setupEventStreamListeners();
    this.loadNotes().subscribe();
  }

  // private setupSaveSubscription() {
  //   this.saveSubject
  //     .pipe(
  //       // Group saves by note ID so one note doesn't block another
  //       groupBy((req) => req.id),
  //       // For each group (each note ID), debounce
  //       mergeMap((group) =>
  //         group.pipe(
  //           debounceTime(1000), // Wait 1 second of silence
  //           switchMap((req) => {
  //             console.log('[NoteService] Processing debounced save for', req.id);
  //             return this.http
  //               .put<{ note: Note }>(`/api/notes/${req.id}`, { automergeDoc: req.base64Data })
  //               .pipe(
  //                 tap(() => console.log('[NoteService] Synced automerge doc to server', req.id)),
  //                 catchError((err) => {
  //                   console.error('[NoteService] Failed to sync automerge doc', err);
  //                   return of(null);
  //                 }),
  //               );
  //           }),
  //         ),
  //       ),
  //     )
  //     .subscribe();
  // }

  private setupEventStreamListeners() {
    //  Listen for note.created events
    this.realtimeWS
      .on('note.created')
      .pipe(
        tap((event: Extract<AppEvent, { type: 'note.created' }>) => {
          const documentId = event.note.documentId;
          if (!this.store.query(getEntity(documentId))) {
            this.store.update(addEntities(event.note));
            this.persistToIndexedDB([event.note]);
          }
        }),
        debounceTime(1000),
        switchMap((event: Extract<AppEvent, { type: 'note.created' }>) => {
          return this.getNote(event.note.documentId);
        }),
      )
      .subscribe();
    // Listen for note.updated events
    this.realtimeWS
      .on('note.updated')
      .subscribe((event: Extract<AppEvent, { type: 'note.updated' }>) => {
        this.store.update(
          updateEntities(event.noteId, (note) => ({
            ...note,
            title: event.title ?? note.title,
            updatedAt: event.updatedAt,
          })),
        );
      });
    // Listen for note.deleted events
    this.realtimeWS
      .on('note.deleted')
      .subscribe((event: Extract<AppEvent, { type: 'note.deleted' }>) => {
        this.store.update(deleteEntities(event.noteId));
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(event.noteId, STORE_NAME);
        }
      });
    // Listen for note.trashed events
    this.realtimeWS
      .on('note.trashed')
      .subscribe((event: Extract<AppEvent, { type: 'note.trashed' }>) => {
        // Remove from visible list (user can view trash separately)
        this.store.update(deleteEntities(event.noteId));
      });
    // Listen for note.restored events
    this.realtimeWS
      .on('note.restored')
      .subscribe((event: Extract<AppEvent, { type: 'note.restored' }>) => {
        this.store.update(upsertEntities([event.note]));
        this.persistToIndexedDB([event.note]);
      });
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
    this.init = true;
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

    const httpCall = this.http.get<{ note: Note }>(`/api/notes/${noteId}`).pipe(
      tap((response) => {
        this.store.update(upsertEntities(response.note));
        this.persistToIndexedDB([response.note]);
        this._isLoading.set(false);
      }),
      map((response) => response.note),
      map((data) => ({ source: 'server', data })),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to fetch note';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => err);
      }),
    );

    const localData = this.store.pipe(
      selectEntity(noteId),
      map((data) => ({ source: 'local', data })),
    );

    return merge(localData, httpCall).pipe(
      takeWhile(({ source }) => source !== 'server', true),
      map(({ data }) => data),
      filterNil(),
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
          this.store.update(updateEntities(response.note.documentId, response.note));
          this.persistToIndexedDB([response.note]);
          this._isLoading.set(false);
        }),
        map((response) => response.note),
      ),
    );
  }

  updateAutoMerge(id: string, data: any) {
    const original = this.store.query(getEntity(id)) as Note;
    // if (!original) {
    //   return throwError(() => new Error('Note not found'));
    // }

    const snapshot = data.key[1] === 'snapshot';
    const automergeDoc = snapshot ? [] : (original.automergeDoc ?? []);
    automergeDoc.push(data);
    return this.updateNote(id, { automergeDoc });
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

    // // Optimistic update
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
   * Save sync metadata
   */
  async saveSyncMetadata(key: string, data: Uint8Array): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.indexedDB.put({ key, value: data }, DB_STORES.SYNC_METADATA);
  }

  /**
   * Get note directly from storage (bypassing in-memory store)
   */
  async getNoteFromStorage(id: string): Promise<Note | undefined> {
    if (!isPlatformBrowser(this.platformId)) return undefined;
    return this.indexedDB.get<Note>(id, STORE_NAME);
  }

  /**
   * Get all notes directly from storage
   */
  async getAllNotesFromStorage(): Promise<Note[]> {
    if (!isPlatformBrowser(this.platformId)) return [];
    return this.indexedDB.getAll<Note>(STORE_NAME);
  }

  // /**
  //  * Save Automerge document
  //  * - Updates local store/IndexedDB immediately
  //  * - Triggers debounced background API sync
  //  */
  // async saveAutomergeDoc(id: string, base64Data: string): Promise<void> {
  //   let original = this.store.query(getEntity(id));

  //   // If not in memory, try fetching from storage
  //   if (!original) {
  //     original = await this.getNoteFromStorage(id);
  //   }

  //   if (!original) {
  //     console.warn('[NoteService] Cannot save Automerge doc, note not found locally:', id);
  //     return;
  //   }

  //   // 1. Optimistic local update (this happens immediately on every keystroke/save)
  //   const updatedNote: Note = {
  //     ...original,
  //     automergeDoc: base64Data, // Store as base64 string locally
  //     updatedAt: new Date().toISOString(),
  //   };

  //   // console.log('[NoteService] Saving automerge doc locally', id);

  //   // Update memory if present
  //   if (this.store.query(getEntity(id))) {
  //     this.store.update(updateEntities(id, updatedNote));
  //   }

  //   // Always persist to DB
  //   await this.persistToIndexedDB([updatedNote]);

  //   // 2. Queue sync to server via Subject
  //   this.saveSubject.next({ id, base64Data });
  // }

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
  queryNote(id: string): Note | undefined {
    return this.store.query(getEntity(id));
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
  select(id: string): Observable<Note> {
    return this.store.pipe(selectEntity(id)).pipe(filterNil());
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

  async persistToIndexedDB(notes: Note[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || notes.length === 0) return;
    await this.indexedDB.putMany(notes, STORE_NAME);
  }

  /**
   * Add or update a note locally (offline-first)
   * Used for notes created offline before server sync
   */
  addLocalNote(note: Note): void {
    this.store.update(upsertEntities([note]));
  }

  /**
   * Get sync metadata (e.g. storage-adapter-id)
   */
  async getSyncMetadata(key: string): Promise<Uint8Array | undefined> {
    if (!isPlatformBrowser(this.platformId)) return undefined;
    const result = await this.indexedDB.get<{ key: string; value: Uint8Array }>(
      key,
      DB_STORES.SYNC_METADATA,
    );
    return result?.value;
  }
}

import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { map, take, timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { NoteService } from '../services/note.service';
import type { NoteType } from '@maple/shared';

/**
 * Creates a guard that matches routes based on note type.
 * Returns an Observable that checks if the note exists in the store with a timeout.
 */
function createNoteTypeGuard(expectedType: NoteType): CanMatchFn {
  return (route: Route, segments: UrlSegment[]) => {
    const noteService = inject(NoteService);

    // documentId is the second segment (/:tagId/:documentId)
    const documentId = segments[1]?.path;
    if (!documentId) return false;

    // Check if note exists in store synchronously first
    const note = noteService.notes().find((n) => n.documentId === documentId);

    // If note is already in the store, check type immediately
    if (note) {
      return (note.type || 'write') === expectedType;
    }

    // If not in store, wait briefly for it to load (max 1 second)
    return noteService.select(documentId).pipe(
      timeout(1000),
      take(1),
      map((note) => {
        if (!note) return false;
        return (note.type || 'write') === expectedType;
      }),
      catchError(() => of(false)), // If timeout or error, return false
    );
  };
}

/** Guard that matches write-type notes */
export const WriteNoteGuard = createNoteTypeGuard('write');

/** Guard that matches lego-type notes */
export const LegoNoteGuard = createNoteTypeGuard('lego');

/** Guard that matches draw-type notes */
export const DrawNoteGuard = createNoteTypeGuard('draw');

/** Guard that matches kanban-type notes */
export const KanbanNoteGuard = createNoteTypeGuard('kanban');

import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { NoteService } from '../services/note.service';
import type { NoteType } from '@maple/shared';
import { filterNil } from '@ngneat/elf';

/**
 * Creates a guard that matches routes based on note type.
 * Returns an Observable that waits for the note to appear in the store.
 */
function createNoteTypeGuard(expectedType: NoteType): CanMatchFn {
  return (route: Route, segments: UrlSegment[]) => {
    const noteService = inject(NoteService);

    // Note ID is the second segment (/:tagId/:noteId)
    const noteId = segments[1]?.path;
    if (!noteId) return false;

    // Subscribe to the store's selector for this specific note
    return noteService.select(noteId).pipe(
      // Wait until note is loaded
      filterNil(),
      take(1),
      map((note) => (note!.type || 'write') === expectedType),
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

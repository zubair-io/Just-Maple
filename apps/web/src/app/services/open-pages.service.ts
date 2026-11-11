import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'maple-open-pages';
const MAX_OPEN = 8;

/**
 * The pages a person has open in each notebook, newest first.
 * Opening a page puts it in first place; the others move one place along.
 */
@Injectable({ providedIn: 'root' })
export class OpenPagesService {
  private readonly state = signal<Record<string, string[]>>(this.load());

  /** Open page ids for a notebook, first place first. */
  ids(notebookId: string | null): string[] {
    return notebookId ? (this.state()[notebookId] ?? []) : [];
  }

  open(notebookId: string, pageId: string): void {
    const current = this.ids(notebookId);
    if (current[0] === pageId) return;
    this.set(notebookId, [pageId, ...current.filter((id) => id !== pageId)].slice(0, MAX_OPEN));
  }

  close(notebookId: string, pageId: string): void {
    const current = this.ids(notebookId);
    if (!current.includes(pageId)) return;
    this.set(
      notebookId,
      current.filter((id) => id !== pageId),
    );
  }

  private set(notebookId: string, ids: string[]): void {
    this.state.update((state) => ({ ...state, [notebookId]: ids }));
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      // Storage is a convenience; the row still works without it.
    }
  }

  private load(): Record<string, string[]> {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const result: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) {
          result[key] = value.filter((id): id is string => typeof id === 'string');
        }
      }
      return result;
    } catch {
      return {};
    }
  }
}

import type { Notebook } from '@maple/shared';

export { isNotebookShared } from '@maple/shared';

/** Everyone in the notebook: its owner and the people it's shared with. */
export function notebookMemberIds(notebook: Pick<Notebook, 'sharing'>): string[] {
    return [...new Set((notebook.sharing?.sharedWith ?? []).map((entry) => entry.userId))];
}

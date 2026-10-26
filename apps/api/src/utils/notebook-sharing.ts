import type { Notebook } from '@maple/shared';

/**
 * Whether anyone besides the owner can read the notebook: it's public, or shared with
 * someone. The owner is listed in `sharedWith` too, with access level "owner".
 */
export function isNotebookShared(notebook: Pick<Notebook, 'sharing'>): boolean {
    return (
        !!notebook.sharing?.isPublic ||
        !!notebook.sharing?.sharedWith?.some((entry) => entry.accessLevel !== 'owner')
    );
}

/** Everyone in the notebook: its owner and the people it's shared with. */
export function notebookMemberIds(notebook: Pick<Notebook, 'sharing'>): string[] {
    return [...new Set((notebook.sharing?.sharedWith ?? []).map((entry) => entry.userId))];
}

import { computed, signal } from "@angular/core";
import type { TodayDocument } from "../today/today-document.service";
import { localDay } from "../daily-note/daily-note.models";

export interface NoteSessionSnapshot {
  document: TodayDocument | null;
  content: string;
  initial: string;
  generation: number;
  editVersion: number;
  day: string;
  selectedNotebook: string;
  dirty: boolean;
  conflictedDraft: boolean;
  saving: boolean;
  loading: boolean;
  openError: string;
  status: string;
  error: string;
}

/** One atomic local editing snapshot. Components consume readonly selectors;
 * only the document coordinator changes it. Saved file metadata and live text
 * are intentionally separate so a save acknowledgment cannot replace typing.
 */
export class NoteSessionState {
  private readonly value = signal<NoteSessionSnapshot>({
    document: null, content: "", initial: "", generation: 0, editVersion: 0, day: localDay(),
    selectedNotebook: "", dirty: false, conflictedDraft: false, saving: false,
    loading: false, openError: "", status: "", error: "",
  });
  readonly snapshot = this.value.asReadonly();

  select<K extends keyof NoteSessionSnapshot>(key: K) {
    return computed(() => this.value()[key]);
  }

  patch(patch: Partial<NoteSessionSnapshot>) {
    this.value.update(state => ({ ...state, ...patch }));
  }

  adopt(document: TodayDocument, recoverDraft = false) {
    const draft = recoverDraft ? document.draft : undefined;
    const recover = !!draft && (draft.content !== document.content ||
      !!draft.acceptedAutomaticBlockIDs?.length || !!draft.acceptedReplyRunIDs?.length);
    const conflictedDraft = recover && draft.revision !== document.revision;
    this.value.update(state => ({
      ...state, document, content: recover ? draft.content : document.content,
      initial: recover ? draft.content : document.content,
      generation: state.generation + 1, day: document.day,
      selectedNotebook: document.notebookID, dirty: recover, conflictedDraft,
      error: conflictedDraft
        ? "The file changed after this draft was written. Your recovered draft is preserved. Save a recovery copy or reopen the current file."
        : "",
      status: recover ? "Recovered local draft. Review it before saving." : document.readOnly ? "Read only" : "Saved",
    }));
  }

  edit(content: string) {
    this.value.update(state => ({ ...state, content, dirty: true,
      editVersion: state.editVersion + 1, status: "Saving local draft…" }));
  }

  acknowledge(document: TodayDocument, submittedContent: string, newerReceipts: boolean) {
    if (document.documentID !== this.value().document?.documentID)
      throw new Error("A save response belongs to a different note. Your draft is retained.");
    this.value.update(state => {
      const dirty = state.content !== submittedContent || newerReceipts;
      return { ...state, document, dirty, error: "", status: dirty
        ? "Saving newer changes…" : document.indexingPending ? "Saved · indexing pending" : "Saved" };
    });
  }
}

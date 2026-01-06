import { StorageAdapter, StorageKey } from '@automerge/automerge-repo/slim';
import { NoteService } from '../../services/note.service';

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class NoteServiceStorageAdapter implements StorageAdapter {
  constructor(private readonly noteService: NoteService) {}

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    const noteId = key[0];
    console.log('[StorageAdapter] load', key);
    // 1. Try to get immediately from synchronous store
    const localNote = this.noteService.getNoteById(noteId);
    if (localNote?.automergeDoc) {
      if (typeof localNote.automergeDoc === 'string') {
        return base64ToBytes(localNote.automergeDoc);
      }
      return localNote.automergeDoc as unknown as Uint8Array;
    }
    return undefined;
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    const noteId = key[0];

    // Safety check: Don't overwrite full doc with incremental changes if we can help it.
    // Ideally we'd merge them, but for now let's only save FULL snapshots to the NoteService.
    // Automerge Repo works by saving Incremental changes often, and Snapshots occasionally.
    // If we only save Snapshots, we might lose some recent typing if a snapshot hasn't happened.
    // However, saving metadata/increments as the *entire* note content is destructive.

    // Keys usually look like: [docId] (root), [docId, 'snapshot', hash], [docId, 'incremental', hash]

    // Strategy:
    // 1. If it's a snapshot, it's the full doc. Save it.
    // 2. If it's the root key (metadata?), maybe save it?
    // 3. If it's incremental, we SHOULD merge it, but for now let's log and see.

    const isSnapshot = key.includes('snapshot');
    const isIncremental = key.includes('incremental');

    console.log('[StorageAdapter] save called:', key, 'Size:', data.length);

    if (key.length === 1 || isSnapshot) {
      const base64 = bytesToBase64(data);
      await this.noteService.saveAutomergeDoc(noteId, base64);
    } else if (isIncremental) {
      console.warn('[StorageAdapter] Ignoring incremental save for now to prevent overwrite:', key);
      // TODO: Implement merging of incremental changes into the existing Note
      // OR store increments separately in the Note entity (requires schema change).
      // For local-first robustness, we probably want to trigger a compaction/snapshot more often?
    }
  }

  async remove(key: StorageKey): Promise<void> {
    console.log('[StorageAdapter] remove called for key:', key);

    // Only delete the note if the ROOT document is being removed.
    // Ignore deletion of implementation details like old snapshots.
    // if (key.length === 1) {
    //     const noteId = key[0];
    //     this.noteService.deleteNote(noteId);
    // } else {
    //     console.log('[StorageAdapter] Ignoring removal of sub-key:', key);
    // }
  }

  async loadRange(keyPrefix: StorageKey): Promise<{ key: StorageKey; data: Uint8Array }[]> {
    const allNotes = this.noteService.notes();
    const result: { key: StorageKey; data: Uint8Array }[] = [];

    for (const note of allNotes) {
      if (note.automergeDoc && note.documentId) {
        const noteKey = [note.documentId];
        // Simple prefix match
        if (keyPrefix.length === 0 || noteKey[0] === keyPrefix[0]) {
          const data =
            typeof note.automergeDoc === 'string'
              ? base64ToBytes(note.automergeDoc)
              : (note.automergeDoc as unknown as Uint8Array);
          result.push({ key: noteKey, data });
        }
      }
    }
    return result;
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    console.log('[StorageAdapter] removeRange called for prefix:', keyPrefix);
    // Not implemented for now, but required by interface
    // Only used if we want to clear a specific range of documents
    const allNotes = this.noteService.notes();
    for (const note of allNotes) {
      if (note.documentId) {
        const noteKey = [note.documentId];
        if (keyPrefix.length === 0 || noteKey[0] === keyPrefix[0]) {
          this.noteService.deleteNote(note.documentId);
        }
      }
    }
  }
}

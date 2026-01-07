import {
  Automerge,
  isValidAutomergeUrl,
  Repo,
  StorageAdapter,
  StorageAdapterInterface,
  StorageKey,
} from '@automerge/automerge-repo/slim';
import { NoteService } from '../../services/note.service';
import { firstValueFrom, tap, last } from 'rxjs';
import { IndexedDBService } from '../../services/indexed-db.service';
import { DB_STORES } from '../../services/db-stores';

export class NoteServiceStorageAdapter implements StorageAdapterInterface {
  private repo: Repo | null = null;
  private keyPrefixId = '';
  private store: any[] = [];

  constructor(
    private readonly noteService: NoteService,
    private readonly indexedDBService: IndexedDBService,
  ) {}

  // Call this after creating the Repo
  setRepo(repo: Repo) {
    this.repo = repo;
  }

  load(key: StorageKey): Promise<Uint8Array | undefined> {
    this.keyPrefixId = key[0];
    return this.indexedDBService
      .get<{ data: Uint8Array }>(this.keyPrefixId, DB_STORES.AUTOMERGE)
      .then((result) => {
        return result?.data;
      });
  }

  save(key: StorageKey, data: Uint8Array): Promise<void> {
    if (key.length === 1 && typeof key[0] === 'string' && key[0].startsWith('storage-')) {
      this.indexedDBService.put(
        {
          key: key[0],
          data,
        },
        DB_STORES.AUTOMERGE,
      );
      return Promise.resolve();
    }

    if (key[0] === this.keyPrefixId) {
      this.store.push({ key, data });
    }
    this.noteService.updateAutoMerge(key[0], { key, data }).subscribe();
    return Promise.resolve();
  }

  remove(key: StorageKey): Promise<void> {
    return Promise.resolve();
  }

  async loadRange(keyPrefix: StorageKey): Promise<{ key: StorageKey; data: Uint8Array }[]> {
    console.log('loadRange called for prefix:', keyPrefix);
    const id = keyPrefix[0];

    if (id === this.keyPrefixId) {
      console.log('Returning stored data for prefix:', keyPrefix, 'data:', this.store);
      //return this.store;
    }

    const note = this.noteService.queryNote(id);
    console.log('note:', note);
    let document = [{ key: keyPrefix, data: new Uint8Array(0) }];
    if (note?.automergeDoc) {
      const castedDocs = note.automergeDoc.map((chunk: any) => ({
        key: chunk.key,
        data:
          chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(Object.values(chunk.data)),
      }));

      document = castedDocs;
    }
    this.updateFromServer(keyPrefix);

    return Promise.resolve(document);
  }

  removeRange(keyPrefix: StorageKey): Promise<void> {
    return Promise.resolve();
  }

  updateFromServer(keyPrefix: StorageKey) {
    const id = keyPrefix[0];

    if (keyPrefix[1] === 'snapshot') {
      this.noteService
        .getNote(id)
        .pipe(
          last(),
          tap(async (data) => {
            const autoMergeUrl = `automerge:${id}`;

            if (data?.automergeDoc && this.repo && isValidAutomergeUrl(autoMergeUrl)) {
              const handle = await this.repo.find(autoMergeUrl);
              if (handle) {
                await handle.whenReady();

                for (const chunk of data.automergeDoc) {
                  const chunkData =
                    chunk.data instanceof Uint8Array
                      ? chunk.data
                      : new Uint8Array(Object.values(chunk.data));

                  handle.update((doc) => {
                    return Automerge.loadIncremental(doc, chunkData);
                  });
                }
              }
            }
          }),
        )
        .subscribe();
    }
  }
}

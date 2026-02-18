import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DB_STORES } from './db-stores';

interface StoreConfig {
  name: string;
  keyPath: string;
  autoIncrement: boolean;
}

interface DBConfig {
  dbName: string;
  dbVersion: number;
  stores: StoreConfig[];
}

@Injectable({ providedIn: 'root' })
export class IndexedDBService {
  private readonly platformId = inject(PLATFORM_ID);
  private db: IDBDatabase | null = null;
  private initializationPromise: Promise<IDBDatabase> | null = null;

  private readonly config: DBConfig = {
    dbName: 'justmaple',
    dbVersion: 15, // Add google-calendar-tokens and google-calendar-events stores
    stores: [
      { name: DB_STORES.COLLECTIBLE_REGISTRY, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.COLLECTABLE, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.NOTEBOOK, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.PAGE, keyPath: 'id', autoIncrement: false },
      { name: DB_STORES.SYNC_METADATA, keyPath: 'key', autoIncrement: false },
      { name: DB_STORES.MESSAGE, keyPath: 'id', autoIncrement: false },
      { name: DB_STORES.OFFLINE_QUEUE, keyPath: 'id', autoIncrement: false },
      { name: DB_STORES.FS_HANDLES, keyPath: 'key', autoIncrement: false },
      // Gmail stores (local-only, email content never sent to server)
      { name: DB_STORES.GMAIL_EMAILS, keyPath: 'id', autoIncrement: false },
      { name: DB_STORES.GMAIL_TOKENS, keyPath: 'accountEmail', autoIncrement: false },
      { name: DB_STORES.GMAIL_SYNC_STATE, keyPath: 'accountEmail', autoIncrement: false },
      { name: DB_STORES.GMAIL_DRAFTS, keyPath: 'id', autoIncrement: false },
      // Google Calendar stores (local-only, never synced to server)
      { name: DB_STORES.GOOGLE_CALENDAR_TOKENS, keyPath: 'accountEmail', autoIncrement: false },
      { name: DB_STORES.GOOGLE_CALENDAR_EVENTS, keyPath: 'id', autoIncrement: false },
      // Local notebook bot associations
      { name: DB_STORES.LOCAL_NOTEBOOK_BOTS, keyPath: 'notebookId', autoIncrement: false },
    ],
  };

  private async initializeDB(): Promise<IDBDatabase> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('IndexedDB is not available in this environment');
    }

    if (this.db) return this.db;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Only create stores that don't already exist.
        // This preserves offline queue, sync metadata, and cached data on upgrade.
        this.config.stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store.name)) {
            db.createObjectStore(store.name, {
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
            });
          }
        });
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.initializationPromise;
  }

  async get<T>(key: string, storeName: string): Promise<T | undefined> {
    // if (!isPlatformBrowser(this.platformId)) return undefined;

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    if (!isPlatformBrowser(this.platformId)) return [];

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(data: T, storeName: string): Promise<IDBValidKey> {
    if (!isPlatformBrowser(this.platformId)) {
      return '' as IDBValidKey;
    }

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async putMany<T>(data: T[], storeName: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || data.length === 0) return;

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      data.forEach((item) => {
        store.put(item);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async delete(id: string, storeName: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const db = await this.initializeDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearAll(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const db = await this.initializeDB();
    const storeNames = this.config.stores.map((s) => s.name);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, 'readwrite');

      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear();
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

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
    dbVersion: 3,
    stores: [
      { name: DB_STORES.COLLECTIBLE_REGISTRY, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.PAPER, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.TAG, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.NOTE, keyPath: '_id', autoIncrement: false },
      { name: DB_STORES.SYNC_METADATA, keyPath: 'key', autoIncrement: false },
      { name: DB_STORES.MESSAGE, keyPath: '_id', autoIncrement: false },
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
    if (!isPlatformBrowser(this.platformId)) return undefined;

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
}

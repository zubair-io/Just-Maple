import { describe, it, expect, beforeEach } from 'vitest';
import { MockStorageProvider } from '../storage-provider';
import type { StorageProvider, PageData, LocalFolderMeta } from '../storage-provider';

describe('MockStorageProvider', () => {
  let provider: MockStorageProvider;

  beforeEach(() => {
    provider = new MockStorageProvider();
  });

  it('implements StorageProvider interface', () => {
    // Type-level test: ensure MockStorageProvider satisfies StorageProvider
    const _: StorageProvider = provider;
    expect(_).toBeDefined();
  });

  it('CRUD lifecycle: create notebook → add pages → list → delete', async () => {
    const nb = await provider.createFolder('Test Notebook');
    expect(nb.label).toBe('Test Notebook');
    expect(nb.id).toBeTruthy();

    const notebooks = await provider.listFolders();
    expect(notebooks).toHaveLength(1);

    const pageData: PageData = {
      meta: {
        id: 'page-1',
        title: 'Test Page',
        type: 'memo',
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
      },
      body: '# Test\n\nHello world.',
    };

    await provider.savePage('page-1', pageData);
    const fetched = await provider.getPage('page-1');
    expect(fetched.meta.title).toBe('Test Page');
    expect(fetched.body).toContain('Hello world');

    await provider.deletePage('page-1');
    await expect(provider.getPage('page-1')).rejects.toThrow('Page not found');
  });

  it('creates history snapshots on significant saves', async () => {
    const pageData: PageData = {
      meta: {
        id: 'page-2',
        title: 'History Test',
        type: 'memo',
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
      },
      body: 'Content v1',
    };

    // Non-significant save → no snapshot
    await provider.savePage('page-2', pageData, { significant: false });
    let history = await provider.getHistory('page-2');
    expect(history).toHaveLength(0);

    // Significant save → snapshot created
    await provider.savePage('page-2', { ...pageData, body: 'Content v2' }, { significant: true });
    history = await provider.getHistory('page-2');
    expect(history).toHaveLength(1);
    expect(history[0]!.pageId).toBe('page-2');
  });

  it('search finds pages by title and body', async () => {
    const page1: PageData = {
      meta: {
        id: 'p1',
        title: 'Meeting Notes',
        type: 'memo',
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
      },
      body: 'Discuss project timeline.',
    };
    const page2: PageData = {
      meta: {
        id: 'p2',
        title: 'Shopping List',
        type: 'memo',
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
      },
      body: 'Apples, bananas.',
    };

    await provider.savePage('p1', page1);
    await provider.savePage('p2', page2);

    const results = await provider.search('meeting');
    expect(results).toHaveLength(1);
    expect(results[0]!.pageId).toBe('p1');

    const bodyResults = await provider.search('bananas');
    expect(bodyResults).toHaveLength(1);
    expect(bodyResults[0]!.pageId).toBe('p2');
  });

  it('watch returns an unsubscribe function', () => {
    const unsubscribe = provider.watch('nb-1', () => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // should not throw
  });

  it('seed helper populates data for testing', async () => {
    const nb: LocalFolderMeta = {
      id: 'nb-seed',
      label: 'Seeded Notebook',
      createdAt: new Date().toISOString(),
    };
    const pages: PageData[] = [
      {
        meta: {
          id: 'sp1',
          title: 'Seeded Page',
          type: 'memo',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
        },
        body: 'Seeded content.',
      },
    ];

    provider.seed('nb-seed', nb, pages);

    const notebooks = await provider.listFolders();
    expect(notebooks).toHaveLength(1);

    const metas = await provider.listPages('nb-seed');
    expect(metas).toHaveLength(1);
    expect(metas[0]!.title).toBe('Seeded Page');

    const page = await provider.getPage('sp1');
    expect(page.body).toBe('Seeded content.');
  });
});

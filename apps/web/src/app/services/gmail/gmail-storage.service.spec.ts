import { TestBed } from '@angular/core/testing';
import { GmailStorageService } from './gmail-storage.service';
import { IndexedDBService } from '../indexed-db.service';
import type { CachedEmail, GmailFilter, GmailDraft, GmailSyncState } from '@maple/shared';

describe('GmailStorageService', () => {
  let service: GmailStorageService;
  let indexedDBSpy: jasmine.SpyObj<IndexedDBService>;

  const mockEmail: CachedEmail = {
    id: 'msg-123',
    threadId: 'thread-123',
    accountEmail: 'test@gmail.com',
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [{ email: 'test@gmail.com' }],
    subject: 'Test Subject',
    snippet: 'Test snippet...',
    bodyText: 'Test body',
    labelIds: ['INBOX', 'UNREAD'],
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    date: '2026-02-01T10:00:00Z',
    internalDate: Date.now(),
    cachedAt: '2026-02-01T10:00:00Z',
  };

  const mockEmail2: CachedEmail = {
    ...mockEmail,
    id: 'msg-456',
    threadId: 'thread-456',
    from: { email: 'boss@company.com', name: 'Boss' },
    subject: 'Important Work Email',
    isRead: true,
    isStarred: true,
    internalDate: Date.now() - 1000,
  };

  beforeEach(() => {
    indexedDBSpy = jasmine.createSpyObj('IndexedDBService', [
      'getAll',
      'put',
      'putMany',
      'delete',
      'clear',
      'get',
    ]);

    indexedDBSpy.getAll.and.returnValue(Promise.resolve([]));
    indexedDBSpy.put.and.returnValue(Promise.resolve('key'));
    indexedDBSpy.putMany.and.returnValue(Promise.resolve());
    indexedDBSpy.delete.and.returnValue(Promise.resolve());
    indexedDBSpy.clear.and.returnValue(Promise.resolve());
    indexedDBSpy.get.and.returnValue(Promise.resolve(undefined));

    TestBed.configureTestingModule({
      providers: [GmailStorageService, { provide: IndexedDBService, useValue: indexedDBSpy }],
    });

    service = TestBed.inject(GmailStorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialize', () => {
    it('should load cached emails from IndexedDB', async () => {
      indexedDBSpy.getAll.and.returnValue(Promise.resolve([mockEmail, mockEmail2]));

      await service.initialize();

      expect(service.emails().length).toBe(2);
      // Should be sorted by internalDate (newest first)
      expect(service.emails()[0].id).toBe('msg-123');
    });

    it('should load sync state and drafts', async () => {
      const mockSyncState: GmailSyncState = {
        accountEmail: 'test@gmail.com',
        lastSyncAt: '2026-02-01T10:00:00Z',
        status: 'idle',
      };

      indexedDBSpy.getAll.and.callFake((storeName: string) => {
        if (storeName.includes('sync')) return Promise.resolve([mockSyncState]);
        if (storeName.includes('draft')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await service.initialize();

      expect(service.syncState()).toEqual(mockSyncState);
    });
  });

  describe('storeEmails', () => {
    it('should store emails in IndexedDB and update cache', async () => {
      await service.storeEmails([mockEmail]);

      expect(indexedDBSpy.putMany).toHaveBeenCalled();
      expect(service.emails().length).toBe(1);
      expect(service.emails()[0].id).toBe('msg-123');
    });

    it('should update existing emails in cache', async () => {
      await service.storeEmails([mockEmail]);
      const updatedEmail = { ...mockEmail, isRead: true };
      await service.storeEmails([updatedEmail]);

      expect(service.emails().length).toBe(1);
      expect(service.emails()[0].isRead).toBe(true);
    });
  });

  describe('getEmail', () => {
    it('should return email by ID', async () => {
      await service.storeEmails([mockEmail, mockEmail2]);

      const found = service.getEmail('msg-123');

      expect(found).toBeDefined();
      expect(found?.id).toBe('msg-123');
    });

    it('should return undefined for unknown ID', () => {
      expect(service.getEmail('unknown')).toBeUndefined();
    });
  });

  describe('getEmailsByThread', () => {
    it('should return emails from same thread sorted by date', async () => {
      const threadEmail1 = { ...mockEmail, internalDate: 1000 };
      const threadEmail2 = { ...mockEmail, id: 'msg-124', internalDate: 2000 };

      await service.storeEmails([threadEmail2, threadEmail1]);

      const thread = service.getEmailsByThread('thread-123');

      expect(thread.length).toBe(2);
      expect(thread[0].internalDate).toBe(1000);
      expect(thread[1].internalDate).toBe(2000);
    });
  });

  describe('getFilteredEmails', () => {
    beforeEach(async () => {
      await service.storeEmails([mockEmail, mockEmail2]);
    });

    it('should return all emails for "all" filter', () => {
      const filter: GmailFilter = { id: 'all', name: 'All', type: 'all', value: '' };

      const result = service.getFilteredEmails(filter);

      expect(result.length).toBe(2);
    });

    it('should filter by label', () => {
      const filter: GmailFilter = { id: 'inbox', name: 'Inbox', type: 'label', value: 'INBOX' };

      const result = service.getFilteredEmails(filter);

      expect(result.length).toBe(2); // Both have INBOX label
    });

    it('should filter by sender email', () => {
      const filter: GmailFilter = {
        id: 'work',
        name: 'Work',
        type: 'sender',
        value: ['boss@company.com'],
      };

      const result = service.getFilteredEmails(filter);

      expect(result.length).toBe(1);
      expect(result[0].from.email).toBe('boss@company.com');
    });

    it('should filter by sender domain wildcard', () => {
      const filter: GmailFilter = {
        id: 'company',
        name: 'Company',
        type: 'sender',
        value: ['*@company.com'],
      };

      const result = service.getFilteredEmails(filter);

      expect(result.length).toBe(1);
      expect(result[0].from.email).toBe('boss@company.com');
    });

    it('should filter by search query', () => {
      const filter: GmailFilter = {
        id: 'search',
        name: 'Search',
        type: 'search',
        value: 'Important',
      };

      const result = service.getFilteredEmails(filter);

      expect(result.length).toBe(1);
      expect(result[0].subject).toContain('Important');
    });
  });

  describe('searchEmails', () => {
    beforeEach(async () => {
      await service.storeEmails([mockEmail, mockEmail2]);
    });

    it('should search in subject', () => {
      const result = service.searchEmails('Test Subject');

      expect(result.length).toBe(1);
    });

    it('should search in sender email', () => {
      const result = service.searchEmails('boss@company');

      expect(result.length).toBe(1);
    });

    it('should search in sender name', () => {
      const result = service.searchEmails('Sender');

      expect(result.length).toBe(1);
    });

    it('should be case insensitive', () => {
      const result = service.searchEmails('IMPORTANT');

      expect(result.length).toBe(1);
    });

    it('should return all emails for empty query', () => {
      const result = service.searchEmails('');

      expect(result.length).toBe(2);
    });
  });

  describe('deleteEmails', () => {
    it('should remove emails from cache and storage', async () => {
      await service.storeEmails([mockEmail, mockEmail2]);

      await service.deleteEmails(['msg-123']);

      expect(indexedDBSpy.delete).toHaveBeenCalledWith('msg-123', jasmine.any(String));
      expect(service.emails().length).toBe(1);
      expect(service.emails()[0].id).toBe('msg-456');
    });
  });

  describe('updateEmail', () => {
    it('should update email properties', async () => {
      await service.storeEmails([mockEmail]);

      await service.updateEmail('msg-123', { isRead: true, isStarred: true });

      const updated = service.getEmail('msg-123');
      expect(updated?.isRead).toBe(true);
      expect(updated?.isStarred).toBe(true);
    });
  });

  describe('computed signals', () => {
    beforeEach(async () => {
      await service.storeEmails([mockEmail, mockEmail2]);
    });

    it('should compute unread count', () => {
      expect(service.unreadCount()).toBe(1); // mockEmail is unread
    });

    it('should compute starred count', () => {
      expect(service.starredCount()).toBe(1); // mockEmail2 is starred
    });
  });

  describe('drafts', () => {
    const mockDraft: GmailDraft = {
      id: 'draft-123',
      pageId: 'page-123',
      to: ['recipient@example.com'],
      subject: 'Draft Subject',
      body: 'Draft body',
      createdAt: '2026-02-01T10:00:00Z',
      updatedAt: '2026-02-01T10:00:00Z',
    };

    it('should store and retrieve drafts', async () => {
      await service.storeDraft(mockDraft);

      expect(indexedDBSpy.put).toHaveBeenCalled();
      expect(service.getDraft('draft-123')).toBeDefined();
    });

    it('should get drafts for a page', async () => {
      await service.storeDraft(mockDraft);

      const drafts = service.getDraftsForPage('page-123');

      expect(drafts.length).toBe(1);
    });

    it('should delete drafts', async () => {
      await service.storeDraft(mockDraft);
      await service.deleteDraft('draft-123');

      expect(indexedDBSpy.delete).toHaveBeenCalledWith('draft-123', jasmine.any(String));
      expect(service.getDraft('draft-123')).toBeUndefined();
    });
  });

  describe('clearAll', () => {
    it('should clear all Gmail data', async () => {
      await service.storeEmails([mockEmail]);

      await service.clearAll();

      expect(indexedDBSpy.clear).toHaveBeenCalledTimes(3); // emails, sync state, drafts
      expect(service.emails().length).toBe(0);
      expect(service.syncState()).toBeNull();
      expect(service.drafts().length).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return email statistics', async () => {
      await service.storeEmails([mockEmail, mockEmail2]);

      const stats = service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.unread).toBe(1);
      expect(stats.starred).toBe(1);
    });
  });

  describe('special email lists', () => {
    beforeEach(async () => {
      await service.storeEmails([mockEmail, mockEmail2]);
    });

    it('should get inbox emails', () => {
      const inbox = service.getInboxEmails();
      expect(inbox.length).toBe(2);
    });

    it('should get starred emails', () => {
      const starred = service.getStarredEmails();
      expect(starred.length).toBe(1);
    });

    it('should get unread emails', () => {
      const unread = service.getUnreadEmails();
      expect(unread.length).toBe(1);
    });
  });
});

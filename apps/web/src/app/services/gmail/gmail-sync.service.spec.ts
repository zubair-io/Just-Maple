import { TestBed } from '@angular/core/testing';
import { GmailSyncService } from './gmail-sync.service';
import { GmailApiService } from './gmail-api.service';
import { GmailAuthService } from './gmail-auth.service';
import { GmailStorageService } from './gmail-storage.service';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import type { CachedEmail, GmailSyncState } from '@maple/shared';

describe('GmailSyncService', () => {
  let service: GmailSyncService;
  let apiServiceSpy: jasmine.SpyObj<GmailApiService>;
  let authServiceSpy: jasmine.SpyObj<GmailAuthService>;
  let storageServiceSpy: jasmine.SpyObj<GmailStorageService>;

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

  const mockSyncState: GmailSyncState = {
    accountEmail: 'test@gmail.com',
    lastSyncAt: '2026-02-01T10:00:00Z',
    historyId: 'history-123',
    status: 'idle',
  };

  beforeEach(() => {
    apiServiceSpy = jasmine.createSpyObj('GmailApiService', [
      'listMessages',
      'getMessage',
      'getMessages',
      'getHistory',
      'markAsRead',
      'markAsUnread',
      'starMessage',
      'unstarMessage',
      'archiveMessage',
      'trashMessage',
      'deleteMessage',
    ]);

    authServiceSpy = jasmine.createSpyObj('GmailAuthService', [], {
      isConnected: signal(true),
      connectedEmail: signal('test@gmail.com'),
    });

    storageServiceSpy = jasmine.createSpyObj(
      'GmailStorageService',
      ['storeEmails', 'storeEmail', 'getEmail', 'updateEmail', 'deleteEmails', 'storeSyncState'],
      {
        syncState: signal(mockSyncState),
      },
    );

    // Default return values
    apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));
    apiServiceSpy.getMessage.and.returnValue(of(mockEmail));
    apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));
    apiServiceSpy.getHistory.and.returnValue(of({ historyId: 'new-history-123' }));
    apiServiceSpy.markAsRead.and.returnValue(of(undefined));
    apiServiceSpy.markAsUnread.and.returnValue(of(undefined));
    apiServiceSpy.starMessage.and.returnValue(of(undefined));
    apiServiceSpy.unstarMessage.and.returnValue(of(undefined));
    apiServiceSpy.archiveMessage.and.returnValue(of(undefined));
    apiServiceSpy.trashMessage.and.returnValue(of(undefined));
    apiServiceSpy.deleteMessage.and.returnValue(of(undefined));
    storageServiceSpy.storeEmails.and.returnValue(Promise.resolve());
    storageServiceSpy.storeEmail.and.returnValue(Promise.resolve());
    storageServiceSpy.deleteEmails.and.returnValue(Promise.resolve());
    storageServiceSpy.storeSyncState.and.returnValue(Promise.resolve());
    storageServiceSpy.getEmail.and.returnValue(mockEmail);

    TestBed.configureTestingModule({
      providers: [
        GmailSyncService,
        { provide: GmailApiService, useValue: apiServiceSpy },
        { provide: GmailAuthService, useValue: authServiceSpy },
        { provide: GmailStorageService, useValue: storageServiceSpy },
      ],
    });

    service = TestBed.inject(GmailSyncService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should not be syncing initially', () => {
      expect(service.isSyncing()).toBe(false);
    });

    it('should have zero sync progress initially', () => {
      expect(service.syncProgress()).toBe(0);
    });

    it('should have no sync error initially', () => {
      expect(service.syncError()).toBeNull();
    });

    it('should have no last sync date initially', () => {
      expect(service.lastSyncAt()).toBeNull();
    });
  });

  describe('initialSync', () => {
    it('should throw if not connected', (done) => {
      // Reset to disconnected state
      authServiceSpy = jasmine.createSpyObj('GmailAuthService', [], {
        isConnected: signal(false),
        connectedEmail: signal(null),
      });
      TestBed.overrideProvider(GmailAuthService, { useValue: authServiceSpy });
      service = TestBed.inject(GmailSyncService);

      service.initialSync().subscribe({
        error: (err) => {
          expect(err.message).toContain('not connected');
          done();
        },
      });
    });

    it('should set isSyncing to true during sync', (done) => {
      apiServiceSpy.listMessages.and.returnValue(
        of({ messages: [{ id: 'msg-1', threadId: 't-1' }], resultSizeEstimate: 1 }),
      );

      service.initialSync().subscribe({
        complete: () => {
          expect(service.isSyncing()).toBe(false);
          done();
        },
      });

      expect(service.isSyncing()).toBe(true);
    });

    it('should fetch messages based on sync depth', (done) => {
      apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));

      service.initialSync('7d').subscribe({
        complete: () => {
          const call = apiServiceSpy.listMessages.calls.mostRecent();
          expect(call.args[0].query).toContain('after:');
          done();
        },
      });
    });

    it('should store fetched emails', (done) => {
      apiServiceSpy.listMessages.and.returnValue(
        of({ messages: [{ id: 'msg-1', threadId: 't-1' }], resultSizeEstimate: 1 }),
      );
      apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));

      service.initialSync().subscribe({
        complete: () => {
          expect(storageServiceSpy.storeEmails).toHaveBeenCalledWith([mockEmail]);
          done();
        },
      });
    });

    it('should store sync state after completion', (done) => {
      apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));

      service.initialSync().subscribe({
        complete: () => {
          expect(storageServiceSpy.storeSyncState).toHaveBeenCalledWith(
            jasmine.objectContaining({
              accountEmail: 'test@gmail.com',
              status: 'idle',
            }),
          );
          done();
        },
      });
    });

    it('should update lastSyncAt on success', (done) => {
      apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));

      service.initialSync().subscribe({
        complete: () => {
          expect(service.lastSyncAt()).toBeTruthy();
          done();
        },
      });
    });

    it('should set sync error on failure', (done) => {
      apiServiceSpy.listMessages.and.returnValue(throwError(() => new Error('API Error')));

      service.initialSync().subscribe({
        error: () => {
          expect(service.syncError()).toBe('API Error');
          expect(service.isSyncing()).toBe(false);
          done();
        },
      });
    });

    it('should update progress during sync', (done) => {
      apiServiceSpy.listMessages.and.returnValue(
        of({
          messages: [{ id: 'msg-1', threadId: 't-1' }],
          resultSizeEstimate: 10,
        }),
      );
      apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));

      service.initialSync().subscribe({
        complete: () => {
          expect(service.syncProgress()).toBe(100);
          done();
        },
      });
    });
  });

  describe('incrementalSync', () => {
    it('should fall back to initial sync if no historyId', (done) => {
      storageServiceSpy = jasmine.createSpyObj(
        'GmailStorageService',
        ['storeEmails', 'storeSyncState', 'deleteEmails'],
        { syncState: signal(null) },
      );
      storageServiceSpy.storeEmails.and.returnValue(Promise.resolve());
      storageServiceSpy.storeSyncState.and.returnValue(Promise.resolve());
      TestBed.overrideProvider(GmailStorageService, { useValue: storageServiceSpy });
      service = TestBed.inject(GmailSyncService);

      apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));

      const initialSyncSpy = spyOn(service, 'initialSync').and.callThrough();

      service.incrementalSync().subscribe({
        complete: () => {
          expect(initialSyncSpy).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should fetch history changes', (done) => {
      apiServiceSpy.getHistory.and.returnValue(
        of({
          history: [
            {
              id: 'h-1',
              messagesAdded: [{ message: { id: 'msg-new', threadId: 't-new' } }],
            },
          ],
          historyId: 'new-history-456',
        }),
      );
      apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));

      service.incrementalSync().subscribe({
        complete: () => {
          expect(apiServiceSpy.getHistory).toHaveBeenCalledWith('history-123');
          done();
        },
      });
    });

    it('should handle added messages', (done) => {
      apiServiceSpy.getHistory.and.returnValue(
        of({
          history: [
            {
              id: 'h-1',
              messagesAdded: [{ message: { id: 'msg-added', threadId: 't-added' } }],
            },
          ],
          historyId: 'new-history-456',
        }),
      );
      apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));

      service.incrementalSync().subscribe({
        complete: () => {
          expect(apiServiceSpy.getMessages).toHaveBeenCalledWith(['msg-added']);
          expect(storageServiceSpy.storeEmails).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should handle deleted messages', (done) => {
      apiServiceSpy.getHistory.and.returnValue(
        of({
          history: [
            {
              id: 'h-1',
              messagesDeleted: [{ message: { id: 'msg-deleted', threadId: 't-del' } }],
            },
          ],
          historyId: 'new-history-456',
        }),
      );

      service.incrementalSync().subscribe({
        complete: () => {
          expect(storageServiceSpy.deleteEmails).toHaveBeenCalledWith(['msg-deleted']);
          done();
        },
      });
    });

    it('should update sync state with new historyId', (done) => {
      apiServiceSpy.getHistory.and.returnValue(
        of({
          historyId: 'updated-history-789',
        }),
      );

      service.incrementalSync().subscribe({
        complete: () => {
          expect(storageServiceSpy.storeSyncState).toHaveBeenCalledWith(
            jasmine.objectContaining({
              historyId: 'updated-history-789',
            }),
          );
          done();
        },
      });
    });
  });

  describe('refresh', () => {
    it('should fetch recent messages', (done) => {
      apiServiceSpy.listMessages.and.returnValue(
        of({
          messages: [{ id: 'msg-1', threadId: 't-1' }],
          resultSizeEstimate: 1,
        }),
      );
      apiServiceSpy.getMessages.and.returnValue(of([mockEmail]));

      service.refresh().subscribe({
        complete: () => {
          expect(apiServiceSpy.listMessages).toHaveBeenCalledWith({ maxResults: 50 });
          expect(storageServiceSpy.storeEmails).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should update lastSyncAt on success', (done) => {
      apiServiceSpy.listMessages.and.returnValue(of({ messages: [], resultSizeEstimate: 0 }));

      service.refresh().subscribe({
        complete: () => {
          expect(service.lastSyncAt()).toBeTruthy();
          done();
        },
      });
    });

    it('should throw if not connected', (done) => {
      authServiceSpy = jasmine.createSpyObj('GmailAuthService', [], {
        isConnected: signal(false),
        connectedEmail: signal(null),
      });
      TestBed.overrideProvider(GmailAuthService, { useValue: authServiceSpy });
      service = TestBed.inject(GmailSyncService);

      service.refresh().subscribe({
        error: (err) => {
          expect(err.message).toContain('not connected');
          done();
        },
      });
    });
  });

  describe('fetchMessage', () => {
    it('should fetch and cache single message', (done) => {
      apiServiceSpy.getMessage.and.returnValue(of(mockEmail));

      service.fetchMessage('msg-123').subscribe({
        next: (email) => {
          expect(email).toEqual(mockEmail);
          expect(storageServiceSpy.storeEmail).toHaveBeenCalledWith(mockEmail);
          done();
        },
      });
    });
  });

  describe('markAsRead', () => {
    it('should optimistically update storage', (done) => {
      service.markAsRead('msg-123').subscribe({
        complete: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: true });
          expect(apiServiceSpy.markAsRead).toHaveBeenCalledWith('msg-123');
          done();
        },
      });
    });

    it('should revert on API error', (done) => {
      apiServiceSpy.markAsRead.and.returnValue(throwError(() => new Error('API Error')));

      service.markAsRead('msg-123').subscribe({
        error: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: true });
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: false });
          done();
        },
      });
    });
  });

  describe('markAsUnread', () => {
    it('should optimistically update storage', (done) => {
      service.markAsUnread('msg-123').subscribe({
        complete: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: false });
          expect(apiServiceSpy.markAsUnread).toHaveBeenCalledWith('msg-123');
          done();
        },
      });
    });

    it('should revert on API error', (done) => {
      apiServiceSpy.markAsUnread.and.returnValue(throwError(() => new Error('API Error')));

      service.markAsUnread('msg-123').subscribe({
        error: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: false });
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', { isRead: true });
          done();
        },
      });
    });
  });

  describe('starMessage', () => {
    it('should optimistically update storage', (done) => {
      service.starMessage('msg-123').subscribe({
        complete: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            isStarred: true,
          });
          expect(apiServiceSpy.starMessage).toHaveBeenCalledWith('msg-123');
          done();
        },
      });
    });

    it('should revert on API error', (done) => {
      apiServiceSpy.starMessage.and.returnValue(throwError(() => new Error('API Error')));

      service.starMessage('msg-123').subscribe({
        error: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            isStarred: false,
          });
          done();
        },
      });
    });
  });

  describe('unstarMessage', () => {
    it('should optimistically update storage', (done) => {
      service.unstarMessage('msg-123').subscribe({
        complete: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            isStarred: false,
          });
          expect(apiServiceSpy.unstarMessage).toHaveBeenCalledWith('msg-123');
          done();
        },
      });
    });

    it('should revert on API error', (done) => {
      apiServiceSpy.unstarMessage.and.returnValue(throwError(() => new Error('API Error')));

      service.unstarMessage('msg-123').subscribe({
        error: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            isStarred: true,
          });
          done();
        },
      });
    });
  });

  describe('archiveMessage', () => {
    it('should optimistically remove INBOX label', (done) => {
      const emailWithInbox = { ...mockEmail, labelIds: ['INBOX', 'UNREAD'] };
      storageServiceSpy.getEmail.and.returnValue(emailWithInbox);

      service.archiveMessage('msg-123').subscribe({
        complete: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            labelIds: ['UNREAD'],
          });
          expect(apiServiceSpy.archiveMessage).toHaveBeenCalledWith('msg-123');
          done();
        },
      });
    });

    it('should revert on API error', (done) => {
      const emailWithInbox = { ...mockEmail, labelIds: ['INBOX', 'UNREAD'] };
      storageServiceSpy.getEmail.and.returnValue(emailWithInbox);
      apiServiceSpy.archiveMessage.and.returnValue(throwError(() => new Error('API Error')));

      service.archiveMessage('msg-123').subscribe({
        error: () => {
          expect(storageServiceSpy.updateEmail).toHaveBeenCalledWith('msg-123', {
            labelIds: ['INBOX', 'UNREAD'],
          });
          done();
        },
      });
    });

    it('should return immediately if email not found', (done) => {
      storageServiceSpy.getEmail.and.returnValue(undefined);

      service.archiveMessage('nonexistent').subscribe({
        complete: () => {
          expect(apiServiceSpy.archiveMessage).not.toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe('trashMessage', () => {
    it('should delete from local storage after API call', (done) => {
      service.trashMessage('msg-123').subscribe({
        complete: () => {
          expect(apiServiceSpy.trashMessage).toHaveBeenCalledWith('msg-123');
          expect(storageServiceSpy.deleteEmails).toHaveBeenCalledWith(['msg-123']);
          done();
        },
      });
    });
  });

  describe('deleteMessage', () => {
    it('should permanently delete from API and storage', (done) => {
      service.deleteMessage('msg-123').subscribe({
        complete: () => {
          expect(apiServiceSpy.deleteMessage).toHaveBeenCalledWith('msg-123');
          expect(storageServiceSpy.deleteEmails).toHaveBeenCalledWith(['msg-123']);
          done();
        },
      });
    });
  });

  describe('syncEmailState', () => {
    it('should fetch and update single email', (done) => {
      apiServiceSpy.getMessage.and.returnValue(of(mockEmail));

      service.syncEmailState('msg-123').subscribe({
        complete: () => {
          expect(apiServiceSpy.getMessage).toHaveBeenCalledWith('msg-123');
          expect(storageServiceSpy.storeEmail).toHaveBeenCalledWith(mockEmail);
          done();
        },
      });
    });
  });
});

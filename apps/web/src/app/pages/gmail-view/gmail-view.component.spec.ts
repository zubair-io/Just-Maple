import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { GmailViewComponent } from './gmail-view.component';
import { GmailAuthService } from '../../services/gmail/gmail-auth.service';
import { GmailStorageService } from '../../services/gmail/gmail-storage.service';
import { GmailSyncService } from '../../services/gmail/gmail-sync.service';
import { GmailApiService } from '../../services/gmail/gmail-api.service';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { signal } from '@angular/core';
import type { CachedEmail } from '@maple/shared';

describe('GmailViewComponent', () => {
  let component: GmailViewComponent;
  let fixture: ComponentFixture<GmailViewComponent>;
  let authServiceSpy: jasmine.SpyObj<GmailAuthService>;
  let storageServiceSpy: jasmine.SpyObj<GmailStorageService>;
  let syncServiceSpy: jasmine.SpyObj<GmailSyncService>;
  let apiServiceSpy: jasmine.SpyObj<GmailApiService>;
  let pageServiceSpy: jasmine.SpyObj<PageService>;
  let notebookServiceSpy: jasmine.SpyObj<NotebookService>;
  let routeParams$: Subject<{ [key: string]: string }>;

  const mockEmail: CachedEmail = {
    id: 'msg-123',
    threadId: 'thread-123',
    accountEmail: 'test@gmail.com',
    from: { email: 'sender@example.com', name: 'Sender Name' },
    to: [{ email: 'test@gmail.com' }],
    subject: 'Test Subject',
    snippet: 'Test snippet...',
    bodyText: 'Test body content',
    bodyHtml: '<p>Test body content</p>',
    labelIds: ['INBOX', 'UNREAD'],
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    date: '2026-02-01T10:00:00Z',
    internalDate: Date.now(),
    cachedAt: '2026-02-01T10:00:00Z',
  };

  beforeEach(async () => {
    routeParams$ = new Subject();

    authServiceSpy = jasmine.createSpyObj(
      'GmailAuthService',
      ['authenticate', 'disconnect', 'checkConnection'],
      {
        isConnected: signal(false),
        connectedEmail: signal<string | null>(null),
        isAuthenticating: signal(false),
      },
    );

    storageServiceSpy = jasmine.createSpyObj(
      'GmailStorageService',
      ['initialize', 'getEmail', 'getEmailsByThread', 'getFilteredEmails', 'searchEmails'],
      {
        emails: signal<CachedEmail[]>([]),
        unreadCount: signal(0),
        starredCount: signal(0),
      },
    );

    syncServiceSpy = jasmine.createSpyObj(
      'GmailSyncService',
      [
        'initialSync',
        'refresh',
        'markAsRead',
        'markAsUnread',
        'starMessage',
        'unstarMessage',
        'archiveMessage',
        'trashMessage',
      ],
      {
        isSyncing: signal(false),
        syncProgress: signal(0),
        lastSyncAt: signal<Date | null>(null),
        syncError: signal<string | null>(null),
      },
    );

    apiServiceSpy = jasmine.createSpyObj('GmailApiService', ['sendEmail', 'getAttachment']);

    pageServiceSpy = jasmine.createSpyObj('PageService', [], {
      pages: () => [],
    });

    notebookServiceSpy = jasmine.createSpyObj('NotebookService', [], {
      notebooks: () => [],
    });

    // Default return values
    authServiceSpy.authenticate.and.returnValue(of({ email: 'test@gmail.com' }));
    syncServiceSpy.initialSync.and.returnValue(of(undefined));
    syncServiceSpy.refresh.and.returnValue(of(undefined));
    syncServiceSpy.markAsRead.and.returnValue(of(undefined));
    syncServiceSpy.markAsUnread.and.returnValue(of(undefined));
    syncServiceSpy.starMessage.and.returnValue(of(undefined));
    syncServiceSpy.unstarMessage.and.returnValue(of(undefined));
    syncServiceSpy.archiveMessage.and.returnValue(of(undefined));
    syncServiceSpy.trashMessage.and.returnValue(of(undefined));
    apiServiceSpy.sendEmail.and.returnValue(of({ id: 'sent-123', threadId: 'thread-123' }));
    storageServiceSpy.getFilteredEmails.and.returnValue([]);
    storageServiceSpy.searchEmails.and.returnValue([]);

    await TestBed.configureTestingModule({
      imports: [GmailViewComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { params: routeParams$.asObservable() } },
        { provide: GmailAuthService, useValue: authServiceSpy },
        { provide: GmailStorageService, useValue: storageServiceSpy },
        { provide: GmailSyncService, useValue: syncServiceSpy },
        { provide: GmailApiService, useValue: apiServiceSpy },
        { provide: PageService, useValue: pageServiceSpy },
        { provide: NotebookService, useValue: notebookServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GmailViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('route params', () => {
    it('should set notebook and page IDs from route params', () => {
      routeParams$.next({ notebookId: 'nb-123', id: 'page-456' });

      expect(component.selectedNotebookId()).toBe('nb-123');
      expect(component.selectedPageId()).toBe('page-456');
    });
  });

  describe('connectGmail', () => {
    it('should call authenticate and initial sync on success', () => {
      component.connectGmail();

      expect(authServiceSpy.authenticate).toHaveBeenCalled();
      expect(syncServiceSpy.initialSync).toHaveBeenCalled();
    });
  });

  describe('disconnectGmail', () => {
    it('should call disconnect', () => {
      component.disconnectGmail();

      expect(authServiceSpy.disconnect).toHaveBeenCalled();
    });
  });

  describe('refreshEmails', () => {
    it('should call sync refresh', () => {
      component.refreshEmails();

      expect(syncServiceSpy.refresh).toHaveBeenCalled();
    });
  });

  describe('selectEmail', () => {
    it('should set selected email ID', () => {
      storageServiceSpy.getEmail.and.returnValue(mockEmail);

      component.selectEmail(mockEmail);

      expect(component.selectedEmailId()).toBe('msg-123');
    });

    it('should mark unread email as read', () => {
      const unreadEmail = { ...mockEmail, isRead: false };
      storageServiceSpy.getEmail.and.returnValue(unreadEmail);

      component.selectEmail(unreadEmail);

      expect(syncServiceSpy.markAsRead).toHaveBeenCalledWith('msg-123');
    });

    it('should not mark already read email', () => {
      const readEmail = { ...mockEmail, isRead: true };
      storageServiceSpy.getEmail.and.returnValue(readEmail);

      component.selectEmail(readEmail);

      expect(syncServiceSpy.markAsRead).not.toHaveBeenCalled();
    });
  });

  describe('toggleStar', () => {
    it('should unstar a starred email', () => {
      const starredEmail = { ...mockEmail, isStarred: true };
      const event = new Event('click');

      component.toggleStar(starredEmail, event);

      expect(syncServiceSpy.unstarMessage).toHaveBeenCalledWith('msg-123');
    });

    it('should star an unstarred email', () => {
      const unstarredEmail = { ...mockEmail, isStarred: false };
      const event = new Event('click');

      component.toggleStar(unstarredEmail, event);

      expect(syncServiceSpy.starMessage).toHaveBeenCalledWith('msg-123');
    });
  });

  describe('archiveEmail', () => {
    it('should archive email and clear selection', () => {
      component.selectedEmailId.set('msg-123');

      component.archiveEmail(mockEmail);

      expect(syncServiceSpy.archiveMessage).toHaveBeenCalledWith('msg-123');
    });
  });

  describe('trashEmail', () => {
    it('should trash email and clear selection', () => {
      component.selectedEmailId.set('msg-123');

      component.trashEmail(mockEmail);

      expect(syncServiceSpy.trashMessage).toHaveBeenCalledWith('msg-123');
    });
  });

  describe('compose', () => {
    it('should open compose modal', () => {
      component.openCompose();

      expect(component.showCompose()).toBe(true);
    });

    it('should close compose modal and reset state', () => {
      component.openCompose();
      component.composeTo.set(['test@example.com']);
      component.composeSubject.set('Test');

      component.closeCompose();

      expect(component.showCompose()).toBe(false);
      expect(component.composeTo()).toEqual([]);
      expect(component.composeSubject()).toBe('');
    });

    it('should set up reply fields when replying', () => {
      component.openReply(mockEmail);

      expect(component.showCompose()).toBe(true);
      expect(component.composeTo()).toEqual(['sender@example.com']);
      expect(component.composeSubject()).toBe('Re: Test Subject');
      expect(component.replyToEmail()).toBe(mockEmail);
    });

    it('should include CC on reply all', () => {
      const emailWithCc = {
        ...mockEmail,
        cc: [{ email: 'cc1@example.com' }, { email: 'cc2@example.com' }],
      };

      component.openReply(emailWithCc, true);

      expect(component.composeCc()).toEqual(['cc1@example.com', 'cc2@example.com']);
    });
  });

  describe('sendEmail', () => {
    it('should call API and refresh on success', () => {
      component.composeTo.set(['recipient@example.com']);
      component.composeSubject.set('Test Subject');
      component.composeBody.set('Test body');

      component.sendEmail();

      expect(apiServiceSpy.sendEmail).toHaveBeenCalledWith({
        to: ['recipient@example.com'],
        cc: undefined,
        subject: 'Test Subject',
        body: 'Test body',
        replyToMessageId: undefined,
        threadId: undefined,
      });
    });

    it('should include thread info for replies', () => {
      component.openReply(mockEmail);
      component.composeBody.set('Reply body');

      component.sendEmail();

      expect(apiServiceSpy.sendEmail).toHaveBeenCalledWith(
        jasmine.objectContaining({
          replyToMessageId: 'msg-123',
          threadId: 'thread-123',
        }),
      );
    });
  });

  describe('settings', () => {
    it('should open settings modal', () => {
      component.openSettings();

      expect(component.showSettings()).toBe(true);
    });

    it('should close settings modal', () => {
      component.openSettings();

      component.closeSettings();

      expect(component.showSettings()).toBe(false);
    });
  });

  describe('formatDate', () => {
    it('should format today as time', () => {
      const today = new Date().toISOString();
      const formatted = component.formatDate(today);

      expect(formatted).toMatch(/^\d{1,2}:\d{2}/);
    });

    it('should format this week as weekday', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const formatted = component.formatDate(yesterday);

      expect(formatted).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    });

    it('should format older dates as month day', () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const formatted = component.formatDate(oldDate);

      expect(formatted).toMatch(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/);
    });
  });

  describe('formatSender', () => {
    it('should return name if available', () => {
      expect(component.formatSender(mockEmail)).toBe('Sender Name');
    });

    it('should return email if no name', () => {
      const emailNoName = { ...mockEmail, from: { email: 'test@example.com' } };
      expect(component.formatSender(emailNoName)).toBe('test@example.com');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(component.formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(component.formatFileSize(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(component.formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
    });
  });

  describe('filters', () => {
    it('should include default "All Mail" filter', () => {
      const filters = component.filters();

      expect(filters.length).toBeGreaterThanOrEqual(1);
      expect(filters[0].name).toBe('All Mail');
      expect(filters[0].type).toBe('all');
    });

    it('should select filter and clear email selection', () => {
      component.selectedEmailId.set('msg-123');
      const filter = { id: 'inbox', name: 'Inbox', type: 'label' as const, value: 'INBOX' };

      component.selectFilter(filter);

      expect(component.activeFilterId()).toBe('inbox');
      expect(component.selectedEmailId()).toBeNull();
    });
  });
});

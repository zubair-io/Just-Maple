import { TestBed } from '@angular/core/testing';
import { GmailApiService } from './gmail-api.service';
import { GmailAuthService } from './gmail-auth.service';
import { signal } from '@angular/core';
import { firstValueFrom, of } from 'rxjs';

describe('GmailApiService', () => {
  let service: GmailApiService;
  let authServiceSpy: jasmine.SpyObj<GmailAuthService>;

  const mockAccessToken = 'mock-access-token';

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('GmailAuthService', ['getAccessToken'], {
      connectedEmail: signal('test@gmail.com'),
    });

    authServiceSpy.getAccessToken.and.returnValue(Promise.resolve(mockAccessToken));

    TestBed.configureTestingModule({
      providers: [GmailApiService, { provide: GmailAuthService, useValue: authServiceSpy }],
    });

    service = TestBed.inject(GmailApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listMessages', () => {
    it('should call Gmail API with correct params', async () => {
      const mockResponse = {
        messages: [{ id: 'msg-1', threadId: 'thread-1' }],
        resultSizeEstimate: 1,
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      const result = await firstValueFrom(service.listMessages({ maxResults: 10 }));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages?'),
        jasmine.objectContaining({
          headers: jasmine.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        }),
      );
      expect(result.messages).toHaveLength(1);
    });

    it('should include query parameter', async () => {
      const mockResponse = { messages: [], resultSizeEstimate: 0 };
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      await firstValueFrom(service.listMessages({ query: 'in:inbox' }));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('q=in%3Ainbox'),
        jasmine.any(Object),
      );
    });

    it('should include labelIds parameter', async () => {
      const mockResponse = { messages: [], resultSizeEstimate: 0 };
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      await firstValueFrom(service.listMessages({ labelIds: ['INBOX', 'UNREAD'] }));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('labelIds=INBOX&labelIds=UNREAD'),
        jasmine.any(Object),
      );
    });
  });

  describe('getMessage', () => {
    it('should parse message into CachedEmail format', async () => {
      const mockApiMessage = {
        id: 'msg-123',
        threadId: 'thread-123',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Test snippet...',
        internalDate: Date.now().toString(),
        payload: {
          headers: [
            { name: 'From', value: 'Sender Name <sender@example.com>' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Subject', value: 'Test Subject' },
          ],
          mimeType: 'text/plain',
          body: {
            data: btoa('Hello World').replace(/\+/g, '-').replace(/\//g, '_'),
          },
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-123'));

      expect(email.id).toBe('msg-123');
      expect(email.threadId).toBe('thread-123');
      expect(email.from.email).toBe('sender@example.com');
      expect(email.from.name).toBe('Sender Name');
      expect(email.to[0].email).toBe('recipient@example.com');
      expect(email.subject).toBe('Test Subject');
      expect(email.isRead).toBe(false);
      expect(email.labelIds).toContain('INBOX');
    });

    it('should handle message with no name in from field', async () => {
      const mockApiMessage = {
        id: 'msg-124',
        threadId: 'thread-124',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Subject', value: 'No Name Test' },
          ],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-124'));

      expect(email.from.email).toBe('sender@example.com');
      expect(email.from.name).toBeUndefined();
    });

    it('should mark as read if UNREAD label is absent', async () => {
      const mockApiMessage = {
        id: 'msg-125',
        threadId: 'thread-125',
        labelIds: ['INBOX'], // No UNREAD
        internalDate: Date.now().toString(),
        payload: { headers: [] },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-125'));

      expect(email.isRead).toBe(true);
    });

    it('should identify starred messages', async () => {
      const mockApiMessage = {
        id: 'msg-126',
        threadId: 'thread-126',
        labelIds: ['INBOX', 'STARRED'],
        internalDate: Date.now().toString(),
        payload: { headers: [] },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-126'));

      expect(email.isStarred).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('should fetch multiple messages in batches', async () => {
      const fetchSpy = spyOn(window, 'fetch');

      // Mock responses for 3 messages
      for (let i = 1; i <= 3; i++) {
        const mockMessage = {
          id: `msg-${i}`,
          threadId: `thread-${i}`,
          labelIds: [],
          internalDate: Date.now().toString(),
          payload: { headers: [] },
        };
        fetchSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify(mockMessage))));
      }

      const emails = await firstValueFrom(service.getMessages(['msg-1', 'msg-2', 'msg-3']));

      expect(emails.length).toBe(3);
    });
  });

  describe('sendEmail', () => {
    it('should send email with raw RFC 2822 format', async () => {
      const mockResponse = { id: 'sent-123', threadId: 'thread-sent' };
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      const result = await firstValueFrom(
        service.sendEmail({
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Hello World',
        }),
      );

      expect(result.id).toBe('sent-123');
      expect(fetchSpy).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages/send'),
        jasmine.objectContaining({
          method: 'POST',
          body: jasmine.stringContaining('raw'),
        }),
      );
    });

    it('should include CC recipients', async () => {
      const mockResponse = { id: 'sent-124', threadId: 'thread-sent' };
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      await firstValueFrom(
        service.sendEmail({
          to: ['to@example.com'],
          cc: ['cc@example.com'],
          subject: 'With CC',
          body: 'Body',
        }),
      );

      const call = fetchSpy.calls.mostRecent();
      const body = JSON.parse(call.args[1]?.body as string);
      const raw = atob(body.raw.replace(/-/g, '+').replace(/_/g, '/'));

      expect(raw).toContain('Cc: cc@example.com');
    });
  });

  describe('modifyMessage', () => {
    it('should add labels to message', async () => {
      const mockResponse = { id: 'msg-123', labelIds: ['INBOX', 'STARRED'] };
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      await firstValueFrom(service.modifyMessage('msg-123', { addLabelIds: ['STARRED'] }));

      expect(fetchSpy).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages/msg-123/modify'),
        jasmine.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should remove labels from message', async () => {
      const mockResponse = { id: 'msg-123', labelIds: ['INBOX'] };
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      await firstValueFrom(service.modifyMessage('msg-123', { removeLabelIds: ['UNREAD'] }));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages/msg-123/modify'),
        jasmine.any(Object),
      );
    });
  });

  describe('markAsRead', () => {
    it('should remove UNREAD label', async () => {
      const modifySpy = spyOn(service, 'modifyMessage').and.returnValue(
        of({ id: 'msg-123', labelIds: [] }),
      );

      await firstValueFrom(service.markAsRead('msg-123'));

      expect(modifySpy).toHaveBeenCalledWith('msg-123', { removeLabelIds: ['UNREAD'] });
    });
  });

  describe('markAsUnread', () => {
    it('should add UNREAD label', async () => {
      const modifySpy = spyOn(service, 'modifyMessage').and.returnValue(
        of({ id: 'msg-123', labelIds: ['UNREAD'] }),
      );

      await firstValueFrom(service.markAsUnread('msg-123'));

      expect(modifySpy).toHaveBeenCalledWith('msg-123', { addLabelIds: ['UNREAD'] });
    });
  });

  describe('starMessage', () => {
    it('should add STARRED label', async () => {
      const modifySpy = spyOn(service, 'modifyMessage').and.returnValue(
        of({ id: 'msg-123', labelIds: ['STARRED'] }),
      );

      await firstValueFrom(service.starMessage('msg-123'));

      expect(modifySpy).toHaveBeenCalledWith('msg-123', { addLabelIds: ['STARRED'] });
    });
  });

  describe('unstarMessage', () => {
    it('should remove STARRED label', async () => {
      const modifySpy = spyOn(service, 'modifyMessage').and.returnValue(
        of({ id: 'msg-123', labelIds: [] }),
      );

      await firstValueFrom(service.unstarMessage('msg-123'));

      expect(modifySpy).toHaveBeenCalledWith('msg-123', { removeLabelIds: ['STARRED'] });
    });
  });

  describe('archiveMessage', () => {
    it('should remove INBOX label', async () => {
      const modifySpy = spyOn(service, 'modifyMessage').and.returnValue(
        of({ id: 'msg-123', labelIds: [] }),
      );

      await firstValueFrom(service.archiveMessage('msg-123'));

      expect(modifySpy).toHaveBeenCalledWith('msg-123', { removeLabelIds: ['INBOX'] });
    });
  });

  describe('trashMessage', () => {
    it('should call trash endpoint', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 204 })));

      await firstValueFrom(service.trashMessage('msg-123'));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages/msg-123/trash'),
        jasmine.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('deleteMessage', () => {
    it('should call delete endpoint', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 204 })));

      await firstValueFrom(service.deleteMessage('msg-123'));

      expect(window.fetch).toHaveBeenCalledWith(
        jasmine.stringContaining('/messages/msg-123'),
        jasmine.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('listLabels', () => {
    it('should return labels array', async () => {
      const mockResponse = {
        labels: [
          { id: 'INBOX', name: 'INBOX', type: 'system' },
          { id: 'STARRED', name: 'STARRED', type: 'system' },
        ],
      };
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      const labels = await firstValueFrom(service.listLabels());

      expect(labels.length).toBe(2);
      expect(labels[0].id).toBe('INBOX');
    });
  });

  describe('getAttachment', () => {
    it('should decode base64 attachment', async () => {
      const mockData = btoa('attachment content').replace(/\+/g, '-').replace(/\//g, '_');
      const mockResponse = { size: 18, data: mockData };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockResponse))),
      );

      const blob = await firstValueFrom(service.getAttachment('msg-123', 'attach-1'));

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle rate limiting (429)', async () => {
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 })),
      );

      await expectAsync(firstValueFrom(service.listMessages())).toBeRejectedWithError(
        /Rate limited/,
      );
    });

    it('should handle auth errors (401)', async () => {
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 })),
      );

      await expectAsync(firstValueFrom(service.listMessages())).toBeRejectedWithError(
        /authentication expired/,
      );
    });
  });

  describe('email address parsing', () => {
    it('should parse email with quoted name', async () => {
      const mockApiMessage = {
        id: 'msg-parse',
        threadId: 'thread-parse',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          headers: [
            { name: 'From', value: '"Doe, John" <john.doe@example.com>' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Subject', value: 'Quoted Name' },
          ],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-parse'));

      expect(email.from.email).toBe('john.doe@example.com');
      expect(email.from.name).toBe('Doe, John');
    });

    it('should parse multiple CC addresses', async () => {
      const mockApiMessage = {
        id: 'msg-cc',
        threadId: 'thread-cc',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'to@example.com' },
            { name: 'Cc', value: 'cc1@example.com, "CC Two" <cc2@example.com>' },
            { name: 'Subject', value: 'Multiple CC' },
          ],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-cc'));

      expect(email.cc).toBeDefined();
      expect(email.cc?.length).toBe(2);
      expect(email.cc?.[0].email).toBe('cc1@example.com');
      expect(email.cc?.[1].email).toBe('cc2@example.com');
      expect(email.cc?.[1].name).toBe('CC Two');
    });
  });

  describe('payload parsing', () => {
    it('should extract plain text body', async () => {
      const plainText = 'Hello, this is plain text.';
      const mockApiMessage = {
        id: 'msg-text',
        threadId: 'thread-text',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          mimeType: 'text/plain',
          body: {
            data: btoa(plainText).replace(/\+/g, '-').replace(/\//g, '_'),
          },
          headers: [],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-text'));

      expect(email.bodyText).toBe(plainText);
    });

    it('should extract HTML body', async () => {
      const htmlContent = '<p>Hello, this is HTML.</p>';
      const mockApiMessage = {
        id: 'msg-html',
        threadId: 'thread-html',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          mimeType: 'text/html',
          body: {
            data: btoa(htmlContent).replace(/\+/g, '-').replace(/\//g, '_'),
          },
          headers: [],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-html'));

      expect(email.bodyHtml).toBe(htmlContent);
    });

    it('should identify attachments', async () => {
      const mockApiMessage = {
        id: 'msg-attach',
        threadId: 'thread-attach',
        labelIds: [],
        internalDate: Date.now().toString(),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [],
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: btoa('text').replace(/\+/g, '-').replace(/\//g, '_') },
            },
            {
              mimeType: 'application/pdf',
              filename: 'document.pdf',
              body: { attachmentId: 'attach-id-123', size: 12345 },
            },
          ],
        },
      };

      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify(mockApiMessage))),
      );

      const email = await firstValueFrom(service.getMessage('msg-attach'));

      expect(email.hasAttachments).toBe(true);
      expect(email.attachments).toBeDefined();
      expect(email.attachments?.length).toBe(1);
      expect(email.attachments?.[0].filename).toBe('document.pdf');
      expect(email.attachments?.[0].mimeType).toBe('application/pdf');
      expect(email.attachments?.[0].size).toBe(12345);
    });
  });
});

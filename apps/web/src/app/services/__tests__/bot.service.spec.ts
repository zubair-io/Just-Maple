import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { BotService, BotSuggestion, EnrichedUserBot, CustomBot } from '../bot.service';
import type { BotTemplate, BotInvocation, Thread, Message } from '@maple/shared';

describe('BotService', () => {
  let service: BotService;
  let httpMock: HttpTestingController;

  const mockTemplate: BotTemplate = {
    _id: 'template-1',
    name: 'Hello Bot',
    handle: 'hello',
    description: 'A friendly greeting bot',
    definition: {
      trigger: { mentionPatterns: ['@hello'] },
      input: { includeContext: { mentionText: true } },
      actions: [{ type: 'reply', id: 'reply', config: { message: 'Hello!' } }],
      output: { chatView: { components: [] } },
    },
    requiresConfig: false,
    isSystemBot: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockUserBot: EnrichedUserBot = {
    _id: 'userbot-1',
    userId: 'user-1',
    templateId: 'template-1',
    handle: 'hello',
    displayName: 'My Hello Bot',
    isEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    templateName: 'Hello Bot',
  };

  const mockInvocation: BotInvocation = {
    _id: 'inv-1',
    userBotId: 'userbot-1',
    templateId: 'template-1',
    sourceType: 'message',
    sourceId: 'msg-1',
    notebookId: 'tag-1',
    userId: 'user-1',
    context: { mentionText: '@hello test' },
    variables: {},
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [BotService],
    });

    service = TestBed.inject(BotService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadTemplates', () => {
    it('should load bot templates', (done) => {
      const templates = [mockTemplate];

      service.loadTemplates().subscribe((result) => {
        expect(result).toEqual(templates);
        expect(service.templates()).toEqual(templates);
        done();
      });

      const req = httpMock.expectOne('/api/bot-templates');
      expect(req.request.method).toBe('GET');
      req.flush({ templates });
    });

    it('should set loading state', () => {
      expect(service.templatesLoading()).toBe(false);

      service.loadTemplates().subscribe();
      expect(service.templatesLoading()).toBe(true);

      const req = httpMock.expectOne('/api/bot-templates');
      req.flush({ templates: [] });

      expect(service.templatesLoading()).toBe(false);
    });

    it('should return empty array on error', (done) => {
      service.loadTemplates().subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });

      const req = httpMock.expectOne('/api/bot-templates');
      req.flush({ error: 'Server error' }, { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getTemplate', () => {
    it('should get a single template by id', (done) => {
      service.getTemplate('template-1').subscribe((result) => {
        expect(result).toEqual(mockTemplate);
        done();
      });

      const req = httpMock.expectOne('/api/bot-templates/template-1');
      expect(req.request.method).toBe('GET');
      req.flush({ template: mockTemplate });
    });

    it('should return null on error', (done) => {
      service.getTemplate('invalid').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne('/api/bot-templates/invalid');
      req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('loadUserBots', () => {
    it('should load user bots', (done) => {
      const userBots = [mockUserBot];

      service.loadUserBots().subscribe((result) => {
        expect(result).toEqual(userBots);
        expect(service.userBots()).toEqual(userBots);
        done();
      });

      const req = httpMock.expectOne('/api/user-bots');
      expect(req.request.method).toBe('GET');
      req.flush({ userBots });
    });

    it('should set loading state', () => {
      expect(service.userBotsLoading()).toBe(false);

      service.loadUserBots().subscribe();
      expect(service.userBotsLoading()).toBe(true);

      const req = httpMock.expectOne('/api/user-bots');
      req.flush({ userBots: [] });

      expect(service.userBotsLoading()).toBe(false);
    });
  });

  describe('registerBot', () => {
    it('should register a new bot', (done) => {
      const createData = {
        templateId: 'template-1',
        displayName: 'My Bot',
      };

      service.registerBot(createData).subscribe((result) => {
        expect(result).toEqual(mockUserBot);
        expect(service.userBots()).toContain(mockUserBot);
        done();
      });

      const req = httpMock.expectOne('/api/user-bots');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createData);
      req.flush({ userBot: mockUserBot });
    });

    it('should throw error on failure', (done) => {
      service.registerBot({ templateId: 'invalid' }).subscribe({
        error: (err) => {
          expect(err.message).toBe('Bot already registered');
          done();
        },
      });

      const req = httpMock.expectOne('/api/user-bots');
      req.flush({ error: 'Bot already registered' }, { status: 400, statusText: 'Bad Request' });
    });
  });

  describe('updateBot', () => {
    it('should update a bot', (done) => {
      // First load the user bots
      service.loadUserBots().subscribe();
      httpMock.expectOne('/api/user-bots').flush({ userBots: [mockUserBot] });

      const updateData = { displayName: 'Updated Bot' };
      const updatedBot = { ...mockUserBot, displayName: 'Updated Bot' };

      service.updateBot('userbot-1', updateData).subscribe((result) => {
        expect(result.displayName).toBe('Updated Bot');
        expect(service.userBots()[0].displayName).toBe('Updated Bot');
        done();
      });

      const req = httpMock.expectOne('/api/user-bots/userbot-1');
      expect(req.request.method).toBe('PATCH');
      req.flush({ userBot: updatedBot });
    });
  });

  describe('deleteBot', () => {
    it('should delete a bot', (done) => {
      // First load the user bots
      service.loadUserBots().subscribe();
      httpMock.expectOne('/api/user-bots').flush({ userBots: [mockUserBot] });

      service.deleteBot('userbot-1').subscribe(() => {
        expect(service.userBots().length).toBe(0);
        done();
      });

      const req = httpMock.expectOne('/api/user-bots/userbot-1');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('getTagBots', () => {
    it('should get bots for a tag', (done) => {
      const suggestions: BotSuggestion[] = [
        {
          id: 'userbot-1',
          handle: 'hello',
          displayName: 'Hello Bot',
          type: 'bot',
          ownerId: 'user-1',
          ownerName: 'John Doe',
          ownerAvatar: undefined,
        },
      ];

      service.getTagBots('tag-1').subscribe((result) => {
        expect(result).toEqual(suggestions);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/bots');
      expect(req.request.method).toBe('GET');
      req.flush({ bots: suggestions });
    });

    it('should return cached bots on subsequent calls', (done) => {
      const suggestions: BotSuggestion[] = [
        {
          id: 'userbot-1',
          handle: 'hello',
          displayName: 'Hello Bot',
          type: 'bot',
          ownerId: 'user-1',
          ownerName: 'John Doe',
          ownerAvatar: undefined,
        },
      ];

      // First call
      service.getTagBots('tag-1').subscribe();
      const req = httpMock.expectOne('/api/notebooks/tag-1/bots');
      req.flush({ bots: suggestions });

      // Second call should use cache (no HTTP request)
      service.getTagBots('tag-1').subscribe((result) => {
        expect(result).toEqual(suggestions);
        done();
      });

      // Verify no additional HTTP request was made
      httpMock.expectNone('/api/notebooks/tag-1/bots');
    });

    it('should return empty array on error', (done) => {
      service.getTagBots('tag-1').subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/bots');
      req.flush({ error: 'Server error' }, { status: 500, statusText: 'Server Error' });
    });

    it('should increment cache version when cache is cleared', () => {
      const initialVersion = service.tagBotsCacheVersion();

      service.clearTagBotsCache('tag-1');

      expect(service.tagBotsCacheVersion()).toBe(initialVersion + 1);
    });

    it('should increment cache version when clearing all caches', () => {
      const initialVersion = service.tagBotsCacheVersion();

      service.clearTagBotsCache();

      expect(service.tagBotsCacheVersion()).toBe(initialVersion + 1);
    });
  });

  describe('filterBots', () => {
    it('should filter bots by handle', () => {
      const bots: BotSuggestion[] = [
        {
          id: '1',
          handle: 'hello',
          displayName: 'Hello Bot',
          type: 'bot',
          ownerId: 'user-1',
          ownerName: 'John',
        },
        {
          id: '2',
          handle: 'world',
          displayName: 'World Bot',
          type: 'bot',
          ownerId: 'user-2',
          ownerName: 'Jane',
        },
      ];

      const result = BotService.filterBots(bots, 'hel');
      expect(result.length).toBe(1);
      expect(result[0].handle).toBe('hello');
    });

    it('should filter bots by display name', () => {
      const bots: BotSuggestion[] = [
        {
          id: '1',
          handle: 'bot1',
          displayName: 'Hello Bot',
          type: 'bot',
          ownerId: 'user-1',
          ownerName: 'John',
        },
        {
          id: '2',
          handle: 'bot2',
          displayName: 'World Bot',
          type: 'bot',
          ownerId: 'user-2',
          ownerName: 'Jane',
        },
      ];

      const result = BotService.filterBots(bots, 'world');
      expect(result.length).toBe(1);
      expect(result[0].displayName).toBe('World Bot');
    });

    it('should return all bots when query is empty', () => {
      const bots: BotSuggestion[] = [
        {
          id: '1',
          handle: 'hello',
          displayName: 'Hello Bot',
          type: 'bot',
          ownerId: 'user-1',
          ownerName: 'John',
        },
      ];

      const result = BotService.filterBots(bots, '');
      expect(result.length).toBe(1);
    });
  });

  describe('invokeBot', () => {
    it('should invoke a bot', (done) => {
      service
        .invokeBot('tag-1', 'hello', 'message', 'msg-1', { mentionText: '@hello test' })
        .subscribe((result) => {
          expect(result).toEqual(mockInvocation);
          done();
        });

      const req = httpMock.expectOne('/api/notebooks/tag-1/bots/invoke');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        botHandle: 'hello',
        sourceType: 'message',
        sourceId: 'msg-1',
        context: { mentionText: '@hello test' },
      });
      req.flush({ invocation: mockInvocation });
    });

    it('should throw error on failure', (done) => {
      service.invokeBot('tag-1', 'invalid', 'message', 'msg-1', {}).subscribe({
        error: (err) => {
          expect(err.message).toBe('Bot not found');
          done();
        },
      });

      const req = httpMock.expectOne('/api/notebooks/tag-1/bots/invoke');
      req.flush({ error: 'Bot not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getInvocationStatus', () => {
    it('should get invocation status', (done) => {
      const completedInvocation = { ...mockInvocation, status: 'completed' as const };

      service.getInvocationStatus('inv-1').subscribe((result) => {
        expect(result).toEqual(completedInvocation);
        done();
      });

      const req = httpMock.expectOne('/api/invocations/inv-1');
      expect(req.request.method).toBe('GET');
      req.flush({ invocation: completedInvocation });
    });

    it('should return null on error', (done) => {
      service.getInvocationStatus('invalid').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne('/api/invocations/invalid');
      req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getThreadForMessage', () => {
    it('should get thread for a message', (done) => {
      const mockThread: Thread = {
        _id: 'thread-1',
        parentMessageId: 'msg-1',
        notebookId: 'tag-1',
        messageCount: 2,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const mockMessages: Message[] = [
        {
          _id: 'reply-1',
          notebookId: 'tag-1',
          userId: 'bot-user',
          content: { type: 'doc', content: [] },
          threadId: 'thread-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      service.getThreadForMessage('msg-1').subscribe((result) => {
        expect(result).not.toBeNull();
        expect(result!.thread).toEqual(mockThread);
        expect(result!.messages).toEqual(mockMessages);
        done();
      });

      const req = httpMock.expectOne('/api/messages/msg-1/thread');
      expect(req.request.method).toBe('GET');
      req.flush({ thread: mockThread, messages: mockMessages });
    });

    it('should return null when no thread exists', (done) => {
      service.getThreadForMessage('msg-no-thread').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne('/api/messages/msg-no-thread/thread');
      req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getThreadMessages', () => {
    it('should get thread messages', (done) => {
      const mockMessages: Message[] = [
        {
          _id: 'reply-1',
          notebookId: 'tag-1',
          userId: 'bot-user',
          content: { type: 'doc', content: [] },
          threadId: 'thread-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      service.getThreadMessages('thread-1').subscribe((result) => {
        expect(result).toEqual(mockMessages);
        done();
      });

      const req = httpMock.expectOne('/api/threads/thread-1/messages');
      expect(req.request.method).toBe('GET');
      req.flush({ messages: mockMessages });
    });

    it('should pass limit and before params', (done) => {
      service.getThreadMessages('thread-1', { limit: 10, before: 'msg-5' }).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne('/api/threads/thread-1/messages?limit=10&before=msg-5');
      expect(req.request.method).toBe('GET');
      req.flush({ messages: [] });
    });

    it('should return empty array on error', (done) => {
      service.getThreadMessages('invalid').subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });

      const req = httpMock.expectOne('/api/threads/invalid/messages');
      req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  // ============================================
  // Custom Bots Tests
  // ============================================

  describe('Custom Bots', () => {
    const mockCustomBot: CustomBot = {
      _id: 'custom-bot-1',
      userId: 'user-1',
      handle: 'my-bot',
      displayName: 'My Custom Bot',
      description: 'A test custom bot',
      isEnabled: true,
      botType: 'custom',
      invokeUrl: 'https://my-server.com/webhook',
      permissions: {
        messages: { read: true, write: true },
      },
      jwtExpirationHours: 12,
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    describe('loadCustomBots', () => {
      it('should load custom bots', (done) => {
        const bots = [mockCustomBot];

        service.loadCustomBots().subscribe((result) => {
          expect(result).toEqual(bots);
          expect(service.customBots()).toEqual(bots);
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots');
        expect(req.request.method).toBe('GET');
        req.flush({ bots });
      });

      it('should set loading state', () => {
        expect(service.customBotsLoading()).toBe(false);

        service.loadCustomBots().subscribe();
        expect(service.customBotsLoading()).toBe(true);

        const req = httpMock.expectOne('/api/custom-bots');
        req.flush({ bots: [] });

        expect(service.customBotsLoading()).toBe(false);
      });

      it('should return empty array on error', (done) => {
        service.loadCustomBots().subscribe((result) => {
          expect(result).toEqual([]);
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots');
        req.flush({ error: 'Server error' }, { status: 500, statusText: 'Server Error' });
      });
    });

    describe('createCustomBot', () => {
      it('should create a custom bot and return with provisioning token', (done) => {
        const createData = {
          name: 'My Custom Bot',
          handle: 'my-bot',
          invokeUrl: 'https://my-server.com/webhook',
          permissions: { messages: { read: true, write: true } },
        };

        service.createCustomBot(createData).subscribe((result) => {
          expect(result.handle).toBe('my-bot');
          expect(result.provisioningToken).toBe('prov_abc123');
          expect(service.customBots()).toContain(jasmine.objectContaining({ handle: 'my-bot' }));
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots');
        expect(req.request.method).toBe('POST');
        req.flush({ bot: mockCustomBot, provisioningToken: 'prov_abc123' });
      });

      it('should throw error on failure', (done) => {
        service
          .createCustomBot({
            name: 'Test',
            handle: 'existing',
            invokeUrl: 'https://test.com/webhook',
            permissions: { messages: { read: true, write: true } },
          })
          .subscribe({
            error: (err) => {
              expect(err.message).toBe('Handle already exists');
              done();
            },
          });

        const req = httpMock.expectOne('/api/custom-bots');
        req.flush({ error: 'Handle already exists' }, { status: 400, statusText: 'Bad Request' });
      });
    });

    describe('updateCustomBot', () => {
      it('should update a custom bot', (done) => {
        // First load custom bots
        service.loadCustomBots().subscribe();
        httpMock.expectOne('/api/custom-bots').flush({ bots: [mockCustomBot] });

        const updateData = { name: 'Updated Bot' };
        const updatedBot = { ...mockCustomBot, displayName: 'Updated Bot' };

        service.updateCustomBot('custom-bot-1', updateData).subscribe((result) => {
          expect(result.displayName).toBe('Updated Bot');
          expect(service.customBots()[0].displayName).toBe('Updated Bot');
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1');
        expect(req.request.method).toBe('PATCH');
        req.flush({ bot: updatedBot });
      });
    });

    describe('deleteCustomBot', () => {
      it('should delete a custom bot', (done) => {
        // First load custom bots
        service.loadCustomBots().subscribe();
        httpMock.expectOne('/api/custom-bots').flush({ bots: [mockCustomBot] });

        service.deleteCustomBot('custom-bot-1').subscribe(() => {
          expect(service.customBots().length).toBe(0);
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1');
        expect(req.request.method).toBe('DELETE');
        req.flush({});
      });
    });

    describe('regenerateProvisioningToken', () => {
      it('should regenerate provisioning token', (done) => {
        service.regenerateProvisioningToken('custom-bot-1').subscribe((result) => {
          expect(result).toBe('prov_new_token');
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1/regenerate-token');
        expect(req.request.method).toBe('POST');
        req.flush({ provisioningToken: 'prov_new_token' });
      });
    });

    describe('regenerateWebhookSecret', () => {
      it('should regenerate webhook secret', (done) => {
        // First load custom bots
        service.loadCustomBots().subscribe();
        httpMock.expectOne('/api/custom-bots').flush({ bots: [mockCustomBot] });

        service.regenerateWebhookSecret('custom-bot-1').subscribe((result) => {
          expect(result).toBe('whsec_new_secret');
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1/webhook-secret');
        expect(req.request.method).toBe('POST');
        req.flush({ webhookSecret: 'whsec_new_secret' });
      });
    });

    describe('updateCustomBotStatus', () => {
      it('should update bot status', (done) => {
        // First load custom bots
        service.loadCustomBots().subscribe();
        httpMock.expectOne('/api/custom-bots').flush({ bots: [mockCustomBot] });

        const disabledBot = { ...mockCustomBot, status: 'disabled' as const };

        service.updateCustomBotStatus('custom-bot-1', 'disabled').subscribe((result) => {
          expect(result.status).toBe('disabled');
          expect(service.customBots()[0].status).toBe('disabled');
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1/status');
        expect(req.request.method).toBe('POST');
        req.flush({ bot: disabledBot });
      });
    });

    describe('getCustomBotSessions', () => {
      it('should get bot sessions', (done) => {
        const sessions = [
          {
            _id: 'session-1',
            userBotId: 'custom-bot-1',
            userId: 'user-1',
            jwtId: 'jwt-abc123',
            createdAt: '2024-01-01T00:00:00.000Z',
            expiresAt: '2024-01-01T12:00:00.000Z',
            lastUsedAt: '2024-01-01T01:00:00.000Z',
          },
        ];

        service.getCustomBotSessions('custom-bot-1').subscribe((result) => {
          expect(result).toEqual(sessions);
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1/sessions');
        expect(req.request.method).toBe('GET');
        req.flush({ sessions });
      });

      it('should return empty array on error', (done) => {
        service.getCustomBotSessions('invalid').subscribe((result) => {
          expect(result).toEqual([]);
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/invalid/sessions');
        req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
      });
    });

    describe('revokeAllCustomBotSessions', () => {
      it('should revoke all sessions', (done) => {
        service.revokeAllCustomBotSessions('custom-bot-1').subscribe(() => {
          done();
        });

        const req = httpMock.expectOne('/api/custom-bots/custom-bot-1/sessions');
        expect(req.request.method).toBe('DELETE');
        req.flush({});
      });
    });
  });
});

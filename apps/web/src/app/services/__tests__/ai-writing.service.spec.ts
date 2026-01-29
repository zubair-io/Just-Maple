import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AIWritingService, AIWritingRequest, AIStreamEvent } from '../ai-writing.service';
import type { AIUsageResponse } from '@maple/shared';

describe('AIWritingService', () => {
  let service: AIWritingService;
  let httpMock: HttpTestingController;

  // Mock fetch for SSE streaming tests
  const originalFetch = global.fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AIWritingService],
    });

    service = TestBed.inject(AIWritingService);
    httpMock = TestBed.inject(HttpTestingController);

    // Mock localStorage for auth token
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('test-auth-token'),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    httpMock.verify();
    global.fetch = originalFetch;
  });

  describe('initial state', () => {
    it('should start with isGenerating as false', () => {
      expect(service.isGenerating()).toBe(false);
    });

    it('should start with empty currentText', () => {
      expect(service.currentText()).toBe('');
    });

    it('should start with null error', () => {
      expect(service.error()).toBeNull();
    });
  });

  describe('getUsage', () => {
    it('should get usage statistics', async () => {
      const mockUsage: AIUsageResponse = {
        daily: {
          requests: 10,
          tokens: 5000,
          limit: 50,
        },
        monthly: {
          requests: 100,
          tokens: 50000,
        },
        resetAt: '2024-01-02T00:00:00.000Z',
      };

      const usagePromise = service.getUsage();

      const req = httpMock.expectOne('/api/ai/usage');
      expect(req.request.method).toBe('GET');
      req.flush({ usage: mockUsage });

      const result = await usagePromise;
      expect(result).toEqual(mockUsage);
    });
  });

  describe('cancel', () => {
    it('should set isGenerating to false when cancelled', () => {
      // Simulate starting a generation
      (service as any)._isGenerating.set(true);
      expect(service.isGenerating()).toBe(true);

      service.cancel();

      expect(service.isGenerating()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      // Set some state
      (service as any)._isGenerating.set(true);
      (service as any)._currentText.set('Some text');
      (service as any)._error.set('Some error');

      service.reset();

      expect(service.isGenerating()).toBe(false);
      expect(service.currentText()).toBe('');
      expect(service.error()).toBeNull();
    });
  });

  describe('generate', () => {
    it('should create observable for streaming', () => {
      // Mock fetch to return a stream
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
          }),
        },
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const request: AIWritingRequest = {
        type: 'continue',
        context: 'Some context text',
      };

      const observable = service.generate('notebook-123', request);

      expect(observable).toBeDefined();
      expect(service.isGenerating()).toBe(true);
    });

    it('should handle successful streaming response', (done) => {
      // Create a mock readable stream
      const encoder = new TextEncoder();
      const mockData = [
        'event: token\ndata: {"text":"Hello "}\n\n',
        'event: token\ndata: {"text":"world!"}\n\n',
        'event: done\ndata: {"tokensUsed":10,"finishReason":"stop"}\n\n',
      ];

      let readIndex = 0;
      const mockReader = {
        read: async () => {
          if (readIndex < mockData.length) {
            const value = encoder.encode(mockData[readIndex]);
            readIndex++;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader },
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const request: AIWritingRequest = {
        type: 'continue',
        context: 'Some context',
      };

      const events: AIStreamEvent[] = [];

      service.generate('notebook-123', request).subscribe({
        next: (event) => {
          events.push(event);
        },
        complete: () => {
          expect(events.length).toBe(3);
          expect(events[0]).toEqual({ type: 'token', text: 'Hello ' });
          expect(events[1]).toEqual({ type: 'token', text: 'world!' });
          expect(events[2]).toEqual({
            type: 'done',
            tokensUsed: 10,
            finishReason: 'stop',
          });
          expect(service.currentText()).toBe('Hello world!');
          done();
        },
      });
    });

    it('should handle HTTP errors', (done) => {
      const mockResponse = {
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded', resetAt: '2024-01-02T00:00:00Z' }),
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const request: AIWritingRequest = {
        type: 'continue',
        context: 'Some context',
      };

      service.generate('notebook-123', request).subscribe({
        next: (event) => {
          expect(event.type).toBe('error');
          expect(event.error).toBe('Rate limit exceeded');
          expect(event.resetAt).toBe('2024-01-02T00:00:00Z');
        },
        complete: () => {
          expect(service.error()).toBe('Rate limit exceeded');
          done();
        },
      });
    });

    it('should handle network errors', (done) => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const request: AIWritingRequest = {
        type: 'continue',
        context: 'Some context',
      };

      service.generate('notebook-123', request).subscribe({
        next: (event) => {
          expect(event.type).toBe('error');
          expect(event.error).toBe('Network error');
        },
        complete: () => {
          expect(service.error()).toBe('Network error');
          done();
        },
      });
    });

    it('should include all required fields in request', (done) => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
          }),
        },
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const request: AIWritingRequest = {
        type: 'translate',
        context: 'Some context',
        selection: 'Selected text',
        targetLanguage: 'Spanish',
        instruction: 'Custom instruction',
        pageId: 'page-123',
      };

      service.generate('notebook-123', request).subscribe({
        complete: () => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/ai/generate/notebook-123',
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-auth-token',
              }),
              body: JSON.stringify(request),
            }),
          );
          done();
        },
      });
    });
  });

  describe('action types', () => {
    const actionTypes = [
      'continue',
      'improve',
      'simplify',
      'expand',
      'shorten',
      'summarize',
      'grammar',
      'translate',
      'custom',
    ] as const;

    actionTypes.forEach((type) => {
      it(`should accept ${type} action type`, (done) => {
        const mockResponse = {
          ok: true,
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
        };

        global.fetch = jest.fn().mockResolvedValue(mockResponse);

        const request: AIWritingRequest = {
          type,
          context: 'Some context',
        };

        service.generate('notebook-123', request).subscribe({
          complete: () => {
            expect(global.fetch).toHaveBeenCalledWith(
              '/api/ai/generate/notebook-123',
              expect.objectContaining({
                body: expect.stringContaining(`"type":"${type}"`),
              }),
            );
            done();
          },
        });
      });
    });
  });
});

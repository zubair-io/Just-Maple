import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { CanvasService } from '../canvas.service';
import { IndexedDBService } from '../indexed-db.service';
import type { Canvas, CanvasWidget } from '@maple/shared';

describe('CanvasService', () => {
  let service: CanvasService;
  let httpMock: HttpTestingController;
  let mockIndexedDB: Partial<IndexedDBService>;

  const mockCanvas: Canvas = {
    _id: 'canvas-1',
    id: 'page-1',
    notebookId: 'notebook-1',
    userId: 'user-1',
    connectors: [],
    widgets: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockWidget: CanvasWidget = {
    id: 'widget-1',
    title: 'Book List',
    connectorId: 'conn-1',
    template: { atom: 'text', value: 'Hello' },
    dataPath: '$.books',
    prompt: 'Show my books',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockIndexedDB = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        CanvasService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: IndexedDBService, useValue: mockIndexedDB },
      ],
    });

    service = TestBed.inject(CanvasService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadCanvas', () => {
    it('should fetch canvas from API and update signal', async () => {
      const loadPromise = service.loadCanvas('page-1');

      const req = httpMock.expectOne('/api/canvases/page-1');
      expect(req.request.method).toBe('GET');
      req.flush({ document: mockCanvas });

      await loadPromise;

      expect(service.canvas()).toEqual(mockCanvas);
      expect(service.isLoading()).toBe(false);
    });

    it('should set isLoading while fetching', async () => {
      expect(service.isLoading()).toBe(false);

      const loadPromise = service.loadCanvas('page-1');

      // isLoading should be true during fetch
      expect(service.isLoading()).toBe(true);

      const req = httpMock.expectOne('/api/canvases/page-1');
      req.flush({ document: mockCanvas });
      await loadPromise;

      expect(service.isLoading()).toBe(false);
    });

    it('should try IndexedDB hydration first', async () => {
      (mockIndexedDB.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockCanvas);

      const loadPromise = service.loadCanvas('page-1');

      const req = httpMock.expectOne('/api/canvases/page-1');
      req.flush({ document: { ...mockCanvas, widgets: [mockWidget] } });
      await loadPromise;

      expect(mockIndexedDB.get).toHaveBeenCalledWith('page-1', 'canvas');
      // Final state should be from API
      expect(service.widgets()).toHaveLength(1);
    });

    it('should persist to IndexedDB after fetch', async () => {
      const loadPromise = service.loadCanvas('page-1');

      const req = httpMock.expectOne('/api/canvases/page-1');
      req.flush({ document: mockCanvas });
      await loadPromise;

      expect(mockIndexedDB.put).toHaveBeenCalledWith(mockCanvas, 'canvas');
    });
  });

  describe('addWidget', () => {
    it('should POST to generate endpoint and add widget to store', async () => {
      // First load canvas
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: mockCanvas });
      await loadPromise;

      const addPromise = service.addWidget('Show my books');

      const req = httpMock.expectOne('/api/canvases/page-1/widgets/generate');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ prompt: 'Show my books' });
      req.flush({ widget: mockWidget });

      const result = await addPromise;

      expect(result).toEqual(mockWidget);
      expect(service.widgets()).toHaveLength(1);
      expect(service.widgets()[0].id).toBe('widget-1');
    });

    it('should set isGenerating while adding', async () => {
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: mockCanvas });
      await loadPromise;

      const addPromise = service.addWidget('Show my books');
      expect(service.isGenerating()).toBe(true);

      httpMock.expectOne('/api/canvases/page-1/widgets/generate').flush({ widget: mockWidget });
      await addPromise;

      expect(service.isGenerating()).toBe(false);
    });
  });

  describe('removeWidget', () => {
    it('should DELETE and remove widget from store', async () => {
      const canvasWithWidget = { ...mockCanvas, widgets: [mockWidget] };
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: canvasWithWidget });
      await loadPromise;

      expect(service.widgets()).toHaveLength(1);

      const removePromise = service.removeWidget('widget-1');

      const req = httpMock.expectOne('/api/canvases/page-1/widgets/widget-1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });

      await removePromise;

      expect(service.widgets()).toHaveLength(0);
    });
  });

  describe('regenerateWidget', () => {
    it('should PUT and replace widget in store', async () => {
      const canvasWithWidget = { ...mockCanvas, widgets: [mockWidget] };
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: canvasWithWidget });
      await loadPromise;

      const updatedWidget = { ...mockWidget, title: 'Updated Books' };
      const regenPromise = service.regenerateWidget('widget-1', 'Show books with covers');

      const req = httpMock.expectOne('/api/canvases/page-1/widgets/widget-1/regenerate');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ prompt: 'Show books with covers' });
      req.flush({ widget: updatedWidget });

      const result = await regenPromise;

      expect(result.title).toBe('Updated Books');
      expect(service.widgets()[0].title).toBe('Updated Books');
    });
  });

  describe('widgets signal', () => {
    it('should return empty array when no canvas', () => {
      expect(service.widgets()).toEqual([]);
    });

    it('should return widgets from loaded canvas', async () => {
      const canvas = { ...mockCanvas, widgets: [mockWidget] };
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: canvas });
      await loadPromise;

      expect(service.widgets()).toEqual([mockWidget]);
    });
  });

  describe('clear', () => {
    it('should reset all state', async () => {
      const loadPromise = service.loadCanvas('page-1');
      httpMock.expectOne('/api/canvases/page-1').flush({ document: mockCanvas });
      await loadPromise;

      service.clear();

      expect(service.canvas()).toBeNull();
      expect(service.widgets()).toEqual([]);
      expect(service.isLoading()).toBe(false);
      expect(service.isGenerating()).toBe(false);
    });
  });
});

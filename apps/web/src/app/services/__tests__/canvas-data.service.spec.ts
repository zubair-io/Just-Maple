import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CanvasDataService } from '../canvas-data.service';
import { JsonDocumentService } from '../json-document.service';
import { RealtimeWSService } from '../realtime-ws.service';
import { Subject, of } from 'rxjs';
import type { CanvasWidget, CanvasConnector } from '@maple/shared';

describe('CanvasDataService', () => {
  let service: CanvasDataService;
  let mockJsonDocService: Partial<JsonDocumentService>;
  let dataUpdateSubject: Subject<unknown>;

  const mockWidget: CanvasWidget = {
    id: 'widget-1',
    connectorId: 'conn-1',
    template: { atom: 'text', value: 'Hello' },
    dataPath: '$.books',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockConnector: CanvasConnector = {
    connectorId: 'conn-1',
    connectorType: 'json-page',
    enabled: true,
    name: 'Book Library',
    config: { pageId: 'json-page-1' },
    fields: {},
  };

  const mockJsonData = {
    books: [
      { id: '1', title: 'Dune', author: 'Frank Herbert' },
      { id: '2', title: 'Neuromancer', author: 'William Gibson' },
    ],
    metadata: { count: 2 },
  };

  beforeEach(() => {
    dataUpdateSubject = new Subject();

    mockJsonDocService = {
      fetchDocument: vi.fn().mockReturnValue(
        of({
          _id: 'doc-1',
          id: 'json-page-1',
          pageId: 'json-page-1',
          notebookId: 'notebook-1',
          data: mockJsonData,
          schema: null,
          version: 1,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }),
      ),
      getData$: vi.fn().mockReturnValue(dataUpdateSubject.asObservable()),
    };

    const mockRealtimeWS = {
      events: new Subject().asObservable(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        CanvasDataService,
        { provide: JsonDocumentService, useValue: mockJsonDocService },
        { provide: RealtimeWSService, useValue: mockRealtimeWS },
      ],
    });

    service = TestBed.inject(CanvasDataService);
  });

  describe('loadWidgetData', () => {
    it('should fetch JSON document and resolve dataPath', async () => {
      await service.loadWidgetData(mockWidget, mockConnector);

      expect(mockJsonDocService.fetchDocument).toHaveBeenCalledWith('json-page-1');
      expect(service.getWidgetData('widget-1')).toEqual(mockJsonData.books);
    });

    it('should use root data when dataPath is null', async () => {
      const widgetNoPath = { ...mockWidget, dataPath: undefined };

      await service.loadWidgetData(widgetNoPath, mockConnector);

      expect(service.getWidgetData('widget-1')).toEqual(mockJsonData);
    });

    it('should resolve nested dataPath', async () => {
      const widgetNested = { ...mockWidget, dataPath: '$.metadata.count' };

      await service.loadWidgetData(widgetNested, mockConnector);

      expect(service.getWidgetData('widget-1')).toBe(2);
    });

    it('should not load for non-json-page connectors', async () => {
      const nonJsonConnector = { ...mockConnector, connectorType: 'external-api' };

      await service.loadWidgetData(mockWidget, nonJsonConnector);

      expect(mockJsonDocService.fetchDocument).not.toHaveBeenCalled();
      expect(service.getWidgetData('widget-1')).toBeNull();
    });

    it('should not load when pageId is missing', async () => {
      const connectorNoPage = { ...mockConnector, config: {} };

      await service.loadWidgetData(mockWidget, connectorNoPage);

      expect(mockJsonDocService.fetchDocument).not.toHaveBeenCalled();
    });
  });

  describe('getWidgetData', () => {
    it('should return null for unknown widget', () => {
      expect(service.getWidgetData('nonexistent')).toBeNull();
    });

    it('should return data after load', async () => {
      await service.loadWidgetData(mockWidget, mockConnector);
      expect(service.getWidgetData('widget-1')).toEqual(mockJsonData.books);
    });
  });

  describe('subscribeToUpdates', () => {
    it('should update widget data on SSE events', async () => {
      await service.loadWidgetData(mockWidget, mockConnector);

      service.subscribeToUpdates(mockWidget, mockConnector);

      const updatedData = {
        books: [...mockJsonData.books, { id: '3', title: 'Foundation', author: 'Isaac Asimov' }],
        metadata: { count: 3 },
      };

      dataUpdateSubject.next(updatedData);

      expect(service.getWidgetData('widget-1')).toEqual(updatedData.books);
    });
  });

  describe('clear', () => {
    it('should remove all widget data', async () => {
      await service.loadWidgetData(mockWidget, mockConnector);
      expect(service.getWidgetData('widget-1')).not.toBeNull();

      service.clear();

      expect(service.getWidgetData('widget-1')).toBeNull();
    });
  });
});

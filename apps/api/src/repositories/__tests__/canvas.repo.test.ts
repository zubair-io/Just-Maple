import { describe, it, expect } from 'vitest';
import {
    findCanvasById,
    findOrCreateCanvas,
    updateCanvas,
    addWidget,
    updateWidget,
    removeWidget,
    addConnector,
} from '../canvas.repo';
import {
    createCanvasFixture,
    createCanvasWidgetFixture,
    createCanvasConnectorFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('CanvasRepo', () => {
    describe('findCanvasById', () => {
        it('should return canvas when it exists', async () => {
            const fixture = await createCanvasFixture();

            const canvas = await findCanvasById(fixture.id);

            expect(canvas).not.toBeNull();
            expect(canvas!.id).toBe(fixture.id);
            expect(canvas!.notebookId).toBe(fixture.notebookId);
            expect(canvas!.userId).toBe(fixture.userId);
        });

        it('should return null when canvas does not exist', async () => {
            const canvas = await findCanvasById('nonexistent-id');

            expect(canvas).toBeNull();
        });
    });

    describe('findOrCreateCanvas', () => {
        it('should return existing canvas if found', async () => {
            const fixture = await createCanvasFixture();

            const canvas = await findOrCreateCanvas(fixture.id, fixture.notebookId, fixture.userId);

            expect(canvas.id).toBe(fixture.id);
            expect(canvas._id).toBe(fixture._id.toString());
        });

        it('should create new canvas when not found', async () => {
            const pageId = 'new-page-id';
            const notebookId = 'notebook-1';
            const userId = 'user-1';

            const canvas = await findOrCreateCanvas(pageId, notebookId, userId);

            expect(canvas.id).toBe(pageId);
            expect(canvas.notebookId).toBe(notebookId);
            expect(canvas.userId).toBe(userId);
            expect(canvas.widgets).toEqual([]);
            expect(canvas.connectors).toEqual([]);

            // Verify it was persisted
            const found = await findCanvasById(pageId);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(pageId);
        });
    });

    describe('updateCanvas', () => {
        it('should update canvas widgets', async () => {
            const fixture = await createCanvasFixture();
            const widget = createCanvasWidgetFixture();

            const updated = await updateCanvas(fixture.id, { widgets: [widget] });

            expect(updated).not.toBeNull();
            expect(updated!.widgets).toHaveLength(1);
            expect(updated!.widgets[0].id).toBe(widget.id);
        });

        it('should update canvas connectors', async () => {
            const fixture = await createCanvasFixture();
            const connector = createCanvasConnectorFixture();

            const updated = await updateCanvas(fixture.id, { connectors: [connector] });

            expect(updated).not.toBeNull();
            expect(updated!.connectors).toHaveLength(1);
            expect(updated!.connectors[0].connectorId).toBe(connector.connectorId);
        });

        it('should return null for nonexistent canvas', async () => {
            const result = await updateCanvas('nonexistent', { widgets: [] });

            expect(result).toBeNull();
        });
    });

    describe('addWidget', () => {
        it('should add widget to canvas', async () => {
            const fixture = await createCanvasFixture();
            const widget = createCanvasWidgetFixture();

            const updated = await addWidget(fixture.id, widget as any);

            expect(updated).not.toBeNull();
            expect(updated!.widgets).toHaveLength(1);
            expect(updated!.widgets[0].id).toBe(widget.id);
            expect(updated!.widgets[0].title).toBe(widget.title);
        });

        it('should append widget to existing list', async () => {
            const existingWidget = createCanvasWidgetFixture({ title: 'First' });
            const fixture = await createCanvasFixture({ widgets: [existingWidget] });
            const newWidget = createCanvasWidgetFixture({ title: 'Second' });

            const updated = await addWidget(fixture.id, newWidget as any);

            expect(updated).not.toBeNull();
            expect(updated!.widgets).toHaveLength(2);
            expect(updated!.widgets[0].title).toBe('First');
            expect(updated!.widgets[1].title).toBe('Second');
        });

        it('should return null for nonexistent canvas', async () => {
            const widget = createCanvasWidgetFixture();
            const result = await addWidget('nonexistent', widget as any);

            expect(result).toBeNull();
        });
    });

    describe('updateWidget', () => {
        it('should update specific widget fields', async () => {
            const widget = createCanvasWidgetFixture({ title: 'Original' });
            const fixture = await createCanvasFixture({ widgets: [widget] });

            const updated = await updateWidget(fixture.id, widget.id, {
                title: 'Updated Title',
            } as any);

            expect(updated).not.toBeNull();
            expect(updated!.widgets[0].title).toBe('Updated Title');
            expect(updated!.widgets[0].id).toBe(widget.id);
        });

        it('should return null for nonexistent canvas', async () => {
            const result = await updateWidget('nonexistent', 'widget-1', {
                title: 'Updated',
            } as any);

            expect(result).toBeNull();
        });

        it('should return null for nonexistent widget', async () => {
            const fixture = await createCanvasFixture();

            const result = await updateWidget(fixture.id, 'nonexistent-widget', {
                title: 'Updated',
            } as any);

            expect(result).toBeNull();
        });
    });

    describe('removeWidget', () => {
        it('should remove widget from canvas', async () => {
            const widget1 = createCanvasWidgetFixture({ title: 'Keep' });
            const widget2 = createCanvasWidgetFixture({ title: 'Remove' });
            const fixture = await createCanvasFixture({ widgets: [widget1, widget2] });

            const updated = await removeWidget(fixture.id, widget2.id);

            expect(updated).not.toBeNull();
            expect(updated!.widgets).toHaveLength(1);
            expect(updated!.widgets[0].title).toBe('Keep');
        });

        it('should return canvas unchanged when widget not found', async () => {
            const widget = createCanvasWidgetFixture();
            const fixture = await createCanvasFixture({ widgets: [widget] });

            const updated = await removeWidget(fixture.id, 'nonexistent-widget');

            expect(updated).not.toBeNull();
            expect(updated!.widgets).toHaveLength(1);
        });

        it('should return null for nonexistent canvas', async () => {
            const result = await removeWidget('nonexistent', 'widget-1');

            expect(result).toBeNull();
        });
    });

    describe('addConnector', () => {
        it('should add connector to canvas', async () => {
            const fixture = await createCanvasFixture();
            const connector = createCanvasConnectorFixture();

            const updated = await addConnector(fixture.id, connector as any);

            expect(updated).not.toBeNull();
            expect(updated!.connectors).toHaveLength(1);
            expect(updated!.connectors[0].connectorId).toBe(connector.connectorId);
            expect(updated!.connectors[0].connectorType).toBe('json-page');
        });

        it('should append to existing connectors', async () => {
            const existingConnector = createCanvasConnectorFixture({ name: 'First' });
            const fixture = await createCanvasFixture({ connectors: [existingConnector] });
            const newConnector = createCanvasConnectorFixture({ name: 'Second' });

            const updated = await addConnector(fixture.id, newConnector as any);

            expect(updated).not.toBeNull();
            expect(updated!.connectors).toHaveLength(2);
        });

        it('should return null for nonexistent canvas', async () => {
            const connector = createCanvasConnectorFixture();
            const result = await addConnector('nonexistent', connector as any);

            expect(result).toBeNull();
        });
    });
});

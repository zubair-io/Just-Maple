import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as memo from '../../repositories/memo.repo';
import * as whiteboard from '../../repositories/whiteboard.repo';
import * as kanban from '../../repositories/kanban-board.repo';
import { yjsDocumentService } from '../yjs-document.service';
import { yjsWhiteboardService } from '../yjs-whiteboard.service';
import { yjsKanbanService } from '../yjs-kanban.service';

const fixtures = [
    {
        name: 'memo',
        service: yjsDocumentService,
        fail: () =>
            vi.spyOn(memo, 'updateMemoForYJS').mockRejectedValue(new Error('storage unavailable')),
    },
    {
        name: 'whiteboard',
        service: yjsWhiteboardService,
        fail: () =>
            vi
                .spyOn(whiteboard, 'updateWhiteboardState')
                .mockRejectedValue(new Error('storage unavailable')),
    },
    {
        name: 'kanban',
        service: yjsKanbanService,
        fail: () =>
            vi
                .spyOn(kanban, 'upsertKanbanBoard')
                .mockRejectedValue(new Error('storage unavailable')),
    },
];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(fixtures.map(({ service }) => service.shutdown()));
});
describe('durable collaborative shutdown', () => {
    it('persists an edit when shutdown happens before the debounce expires', async () => {
        const id = 'shutdown-persisted-memo';
        const empty = new Y.Doc();
        await memo.createMemo({ id, pageId: id, state: Y.encodeStateAsUpdate(empty) });
        empty.destroy();
        const doc = await yjsDocumentService.getOrCreateDoc(id);
        doc.getText('pending').insert(0, 'written before shutdown');
        await yjsDocumentService.shutdown();
        const saved = await memo.getMemoState(id);
        expect(saved).not.toBeNull();
        const restored = new Y.Doc();
        Y.applyUpdate(restored, saved!);
        expect(restored.getText('pending').toString()).toBe('written before shutdown');
        restored.destroy();
    });
    it.each(fixtures)(
        'reports a failed pending $name save instead of claiming a successful shutdown',
        async ({ service, fail, name }) => {
            const doc = await service.getOrCreateDoc('shutdown-' + name);
            doc.getMap('test').set('unsaved', 'must persist');
            fail();
            await expect(service.shutdown()).rejects.toThrow('storage unavailable');
        },
    );
});

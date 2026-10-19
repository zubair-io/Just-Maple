import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './fixtures';
import * as Y from 'yjs';

export async function createBoard(
    request: APIRequestContext,
    token: string,
    type: 'whiteboard' | 'kanban',
) {
    const headers = { Authorization: `Bearer ${token}` };
    const notebookResponse = await request.post('/api/notebooks', {
        headers,
        data: { label: `Interaction ${crypto.randomUUID()}` },
    });
    expect(notebookResponse.ok()).toBe(true);
    const { notebook } = await notebookResponse.json();
    const pageResponse = await request.post('/api/pages', {
        headers,
        data: { type, title: 'Interaction test', notebookId: notebook._id },
    });
    expect(pageResponse.ok()).toBe(true);
    const { page } = await pageResponse.json();
    return { id: page.id as string, url: `/${notebook._id}/${page.id}` };
}

export async function drawStroke(page: Page) {
    await page.bringToFront();
    const canvas = page.locator('canvas.drawing-canvas');
    await expect(canvas).toBeVisible();
    await page.getByTitle('Pen (P)', { exact: true }).click();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 80, box!.y + 100);
    await page.mouse.down();
    await page.mouse.move(box!.x + 180, box!.y + 150, { steps: 12 });
    await page.mouse.up();
}

export async function whiteboardElementCount(
    request: APIRequestContext,
    token: string,
    id: string,
) {
    const response = await request.get(`/api/whiteboards/${id}/state`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBe(true);
    const { state } = await response.json();
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, Buffer.from(state, 'base64'));
        return doc.getMap('elements').size;
    } finally {
        doc.destroy();
    }
}

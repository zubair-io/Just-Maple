import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ChatViewComponent } from './chat-view.component';

/**
 * "+ New → Activity". The component itself needs most of the app to render, so this
 * runs its method against stand-ins for what it uses.
 */
function stage(createPage: () => unknown) {
  const host = {
    selectedNotebookId: signal<string | null>('nb-1'),
    pageService: { createPage: vi.fn(createPage) },
    router: { navigate: vi.fn().mockResolvedValue(true) },
    dialogService: { alert: vi.fn().mockResolvedValue(undefined) },
  };
  const create = () =>
    (
      ChatViewComponent.prototype as unknown as { createActivityPage(): Promise<void> }
    ).createActivityPage.call(host);
  return { host, create };
}

describe('ChatViewComponent: + New → Activity', () => {
  it('creates the notebook’s one Activity page and opens it', async () => {
    const { host, create } = stage(() => of({ id: 'activity-nb-1', type: 'activity' }));
    await create();
    expect(host.pageService.createPage).toHaveBeenCalledWith({
      id: 'activity-nb-1',
      type: 'activity',
      title: 'Activity',
      notebookId: 'nb-1',
    });
    expect(host.router.navigate).toHaveBeenCalledWith(['/', 'nb-1', 'activity-nb-1']);
    expect(host.dialogService.alert).not.toHaveBeenCalled();
  });

  it('says so when it can’t be added', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, create } = stage(() => throwError(() => new Error('403')));
    await create();
    expect(host.router.navigate).not.toHaveBeenCalled();
    expect(host.dialogService.alert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not add Activity' }),
    );
  });

  it('does nothing without a notebook', async () => {
    const { host, create } = stage(() => of({}));
    host.selectedNotebookId.set(null);
    await create();
    expect(host.pageService.createPage).not.toHaveBeenCalled();
  });
});

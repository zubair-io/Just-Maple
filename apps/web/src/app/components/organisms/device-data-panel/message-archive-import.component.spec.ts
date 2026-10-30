import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { MessageArchiveProgress } from '@maple/shared';
import { MessageArchiveImportComponent } from './message-archive-import.component';
import { MessageHistoryService } from '../../../services/message-history.service';
const job: MessageArchiveProgress = {
  id: 'test-id',
  filename: 'messages.db',
  total: 3,
  undated: 1,
  people: 2,
  groups: 1,
  platforms: [
    { platform: 'aim', count: 2 },
    { platform: 'voice', count: 1 },
  ],
  status: 'ready',
  cursor: 0,
  processed: 0,
  stored: 0,
  duplicates: 0,
};
const api = {
  imports: vi.fn(async () => ({ imports: [] as MessageArchiveProgress[] })),
  preview: vi.fn(async () => job),
  start: vi.fn(async () => ({ ...job, status: 'paused' as const })),
  pause: vi.fn(),
  progress: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  TestBed.configureTestingModule({
    providers: [{ provide: MessageHistoryService, useValue: api }],
  });
});
afterEach(() => TestBed.resetTestingModule());
it('previews the file, lets the owner select platforms, and keeps the original timezone on resume', async () => {
  const fixture = TestBed.createComponent(MessageArchiveImportComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const file = new File(['sqlite-fixture'], 'messages.db');
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  fixture.detectChanges();
  expect(api.preview).toHaveBeenCalledWith(file);
  expect(root.textContent).toContain('1 records have no date');
  fixture.componentInstance.timeZone.set('America/New_York');
  fixture.componentInstance.toggle('voice', false);
  await fixture.componentInstance.start();
  fixture.detectChanges();
  expect(api.start).toHaveBeenCalledWith('test-id', {
    dataset: 'message-archive',
    timeZone: 'America/New_York',
    platforms: ['aim'],
  });
  expect(root.textContent).toContain('Import paused');
});
it('restores saved platform selections and leaves running imports on the server when closed', async () => {
  api.imports.mockResolvedValueOnce({
    imports: [
      {
        ...job,
        status: 'paused',
        cursor: 500,
        timeZone: 'UTC',
        dataset: 'old-history',
        selectedPlatforms: ['voice'],
      },
    ],
  });
  const fixture = TestBed.createComponent(MessageArchiveImportComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.componentInstance.platforms()).toEqual(['voice']);
  expect(fixture.componentInstance.lockedSettings()).toBe(true);
  const close = vi.fn();
  fixture.componentInstance.close.subscribe(close);
  (
    fixture.nativeElement.querySelector('button[aria-label="Close import"]') as HTMLButtonElement
  ).click();
  expect(close).toHaveBeenCalled();
  expect(api.pause).not.toHaveBeenCalled();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteSaveQueue } from './note-save-queue';

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('Durable note saves', () => {
  it('keeps newer edits when an older save finishes and serializes the next save', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const queue = new NoteSaveQueue(write, storage());
    queue.stage('page', 'First');
    const first = queue.flush('page');
    await Promise.resolve();
    await Promise.resolve();
    queue.stage('page', 'Newer');
    const next = queue.flush('page');
    expect(write).toHaveBeenCalledTimes(1);
    complete();
    await first;
    expect(queue.draft('page')).toBe('Newer');
    await next;
    expect(write.mock.calls).toEqual([
      ['page', 'First'],
      ['page', 'Newer'],
    ]);
    expect(queue.draft('page')).toBeNull();
    expect(queue.hasPending).toBe(false);
  });

  it('retains failed edits across recreation and lets the user retry', async () => {
    vi.useFakeTimers();
    const disk = storage();
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('Folder unavailable'))
      .mockResolvedValue(undefined);
    const queue = new NoteSaveQueue(write, disk);
    queue.stage('page', '# Unsaved');
    await expect(queue.flush('page')).rejects.toThrow('Folder unavailable');
    expect(queue.error('page')).toBe('Folder unavailable');
    expect(new NoteSaveQueue(write, disk).draft('page')).toBe('# Unsaved');
    await expect(queue.flushAll()).rejects.toThrow('Folder unavailable');
    expect(write).toHaveBeenCalledTimes(1);
    await queue.retry('page');
    expect(queue.draft('page')).toBeNull();
    expect(queue.error('page')).toBeUndefined();
  });
  it('does not claim a safe recovery draft when storage is full', async () => {
    vi.useFakeTimers();
    const disk = storage();
    disk.setItem = () => {
      throw new Error('Quota exceeded');
    };
    const queue = new NoteSaveQueue(async () => {
      throw new Error('Disk unavailable');
    }, disk);
    queue.stage('page', 'Only in memory');
    expect(queue.draftsAreDurable).toBe(false);
    await expect(queue.flush('page')).rejects.toThrow('Disk unavailable');
    expect(queue.hasPending).toBe(true);
    expect(queue.draftsAreDurable).toBe(false);
  });
});

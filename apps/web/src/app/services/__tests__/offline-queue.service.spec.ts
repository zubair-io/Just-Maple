import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';
import { OfflineQueueService } from '../offline-queue.service';
import { IndexedDBService } from '../indexed-db.service';
import { ConnectivityService } from '../connectivity.service';

describe('OfflineQueueService', () => {
  let post: ReturnType<typeof vi.fn>;
  let queue: OfflineQueueService;

  beforeEach(() => {
    vi.useFakeTimers();
    post = vi.fn(() => throwError(() => ({ status: 429, message: 'Too many requests' })));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { post, put: post, delete: post, patch: post } },
        {
          provide: IndexedDBService,
          useValue: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ConnectivityService, useValue: { canSync: signal(true) } },
      ],
    });
    queue = TestBed.inject(OfflineQueueService);
  });

  afterEach(() => vi.useRealTimers());

  it('waits for its backoff after a failure instead of retrying right away', async () => {
    await queue.enqueue('create-note', 'n1', 'doc1', { title: 'Board', type: 'kanban' });
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
    // One attempt; the next only after the 2-second backoff.
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_100);
    TestBed.tick();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('keeps a change it could not sync, and says so, instead of dropping it', async () => {
    await queue.enqueue('create-note', 'n1', 'doc1', { title: 'Board', type: 'kanban' });
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(70_000);
      TestBed.tick();
    }
    expect(post).toHaveBeenCalledTimes(5);
    expect(queue.queue()).toHaveLength(1);
    expect(queue.lastError()).toContain("Couldn't sync a change after 5 tries");
  });
});

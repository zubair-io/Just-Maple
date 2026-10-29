import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PageService } from './page.service';
import { NoteSaveQueue } from './note-save-queue';

@Injectable({ providedIn: 'root' })
export class LocalNoteSavesService {
  private readonly pages = inject(PageService);
  private readonly revision = signal(0);
  readonly queue = new NoteSaveQueue(
    (id, content) => firstValueFrom(this.pages.saveLocalPageMarkdown(id, content)),
    localStorage,
    () => this.revision.update((value) => value + 1),
  );

  constructor() {
    (window as Window & { __mapleLocalRecoverySafe?: () => boolean }).__mapleLocalRecoverySafe =
      () => this.queue.draftsAreDurable;
    (window as Window & { __mapleLocalFlush?: () => Promise<void> }).__mapleLocalFlush = () =>
      this.queue.flushAll();
    window.addEventListener('pagehide', () => {
      void this.queue.flushAll().catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.queue.flushAll().catch(() => {});
    });
    window.addEventListener('beforeunload', (event) => {
      if (this.queue.hasPending) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  errorFor(id: string): string | undefined {
    this.revision();
    return this.queue.error(id);
  }
  flush(id: string): void {
    void this.queue.flush(id).catch(() => {});
  }
  retry(id: string): void {
    void this.queue.retry(id).catch(() => {});
  }
}

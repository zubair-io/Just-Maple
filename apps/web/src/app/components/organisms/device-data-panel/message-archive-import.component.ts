import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
  computed,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { FormsModule } from '@angular/forms';
import { MESSAGE_PLATFORM_NAMES, type MessageArchiveProgress } from '@maple/shared';
import { MessageHistoryService } from '../../../services/message-history.service';

@Component({
  selector: 'app-message-archive-import',
  standalone: true,
  imports: [FormsModule, DecimalPipe, A11yModule],
  templateUrl: './message-archive-import.component.html',
  styleUrl: './message-archive-import.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageArchiveImportComponent {
  private readonly api = inject(MessageHistoryService);
  readonly close = output<void>();
  readonly changed = output<void>();
  readonly job = signal<MessageArchiveProgress | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly timeZone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  readonly dataset = signal('message-archive');
  readonly platforms = signal<string[]>([]);
  readonly running = computed(() => ['queued', 'importing'].includes(this.job()?.status ?? ''));
  readonly lockedSettings = computed(() => !!this.job()?.cursor || this.running());
  readonly platformNames = MESSAGE_PLATFORM_NAMES;
  private alive = true;
  private request = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      clearTimeout(this.timer);
    });
    const request = this.request;
    void this.api
      .imports()
      .then(({ imports }) => {
        if (!this.alive || request !== this.request) return;
        const job = imports.find((job) => job.status !== 'complete') ?? imports[0];
        if (job) this.setJob(job);
      })
      .catch((error) => this.alive && this.error.set(error.message));
  }
  private setJob(job: MessageArchiveProgress) {
    if (!this.alive) return;
    const wasComplete = this.job()?.status === 'complete';
    this.job.set(job);
    if (job.timeZone) this.timeZone.set(job.timeZone);
    if (job.dataset) this.dataset.set(job.dataset);
    if (job.selectedPlatforms) this.platforms.set(job.selectedPlatforms);
    else if (!this.platforms().length)
      this.platforms.set(job.platforms.map((entry) => entry.platform));
    clearTimeout(this.timer);
    if (['queued', 'importing'].includes(job.status))
      this.timer = setTimeout(() => void this.poll(job.id), 1000);
    if (job.status === 'complete' && !wasComplete) this.changed.emit();
  }
  private async poll(id: string) {
    try {
      const job = await this.api.progress(id);
      if (this.alive && this.job()?.id === id) this.setJob(job);
    } catch (error) {
      if (this.alive)
        this.error.set(error instanceof Error ? error.message : 'Could not check import progress.');
    }
  }
  async choose(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    ++this.request;
    clearTimeout(this.timer);
    this.busy.set(true);
    this.error.set('');
    try {
      const job = await this.api.preview(file);
      if (this.alive) {
        this.platforms.set([]);
        this.setJob(job);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read this archive.');
    } finally {
      this.busy.set(false);
      (event.target as HTMLInputElement).value = '';
    }
  }
  toggle(platform: string, checked: boolean) {
    this.platforms.update((values) =>
      checked ? [...values, platform] : values.filter((value) => value !== platform),
    );
  }
  async start() {
    const job = this.job();
    if (!job) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.setJob(
        await this.api.start(job.id, {
          timeZone: this.timeZone(),
          dataset: this.dataset(),
          platforms: this.platforms(),
        }),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not start the import.');
    } finally {
      this.busy.set(false);
    }
  }
  async pause() {
    const job = this.job();
    if (!job) return;
    this.busy.set(true);
    try {
      const result = await this.api.pause(job.id);
      if (this.alive) this.setJob(result);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not pause the import.');
    } finally {
      this.busy.set(false);
    }
  }
}

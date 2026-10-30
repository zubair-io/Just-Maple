import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { BotService } from './bot.service';

describe('bot identity updates and mention suggestions', () => {
  for (const custom of [false, true])
    it(`refreshes notebook suggestions after a ${custom ? 'webhook' : 'AI'} rename`, async () => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      const service = TestBed.inject(BotService),
        http = TestBed.inject(HttpTestingController);
      const initial = firstValueFrom(service.getNotebookBots('notebook'));
      http
        .expectOne('/api/notebooks/notebook/bots')
        .flush({ bots: [{ id: 'bot', handle: 'old', displayName: 'Old name' }] });
      await initial;
      const version = service.notebookBotsCacheVersion();
      const update = firstValueFrom(
        custom
          ? service.updateCustomBot('bot', { handle: 'new', name: 'New name' })
          : service.updateBot('bot', { handle: 'new', displayName: 'New name' }),
      );
      http.expectOne(`/api/${custom ? 'custom-bots' : 'user-bots'}/bot`).flush({
        [custom ? 'bot' : 'userBot']: { _id: 'bot', handle: 'new', displayName: 'New name' },
      });
      await update;
      expect(service.notebookBotsCacheVersion()).toBeGreaterThan(version);
      const fresh = firstValueFrom(service.getNotebookBots('notebook'));
      http
        .expectOne('/api/notebooks/notebook/bots')
        .flush({ bots: [{ id: 'bot', handle: 'new', displayName: 'New name' }] });
      expect((await fresh)[0]?.handle).toBe('new');
      http.verify();
    });
});

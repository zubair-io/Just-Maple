import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { BotService, type BotSuggestion } from './bot.service';

describe('mention lookup subscriptions', () => {
  let api: BotService, http: HttpTestingController;
  const bots = [{ id: 'maple', handle: 'maple', displayName: 'Maple' }] as BotSuggestion[];
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(BotService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('shares a cold lookup between the main composer and a newly opened thread', async () => {
    const main = firstValueFrom(api.getNotebookBots('notebook'));
    const thread = firstValueFrom(api.getNotebookBots('notebook'));
    http.expectOne('/api/notebooks/notebook/bots').flush({ bots });
    expect(await main).toEqual(bots);
    expect(await thread).toEqual(bots);
  });
  it('can load again after navigation cancels the only subscriber', async () => {
    const first = api.getNotebookBots('notebook').subscribe();
    const abandoned = http.expectOne('/api/notebooks/notebook/bots');
    first.unsubscribe();
    expect(abandoned.cancelled).toBe(true);
    const retry = firstValueFrom(api.getNotebookBots('notebook'));
    http.expectOne('/api/notebooks/notebook/bots').flush({ bots });
    expect(await retry).toEqual(bots);
  });
  it('does not let an older lookup overwrite a refreshed bot name', async () => {
    const old = firstValueFrom(api.getNotebookBots('notebook'));
    const oldRequest = http.expectOne('/api/notebooks/notebook/bots');
    api.clearNotebookBotsCache('notebook');
    const fresh = firstValueFrom(api.getNotebookBots('notebook'));
    http.expectOne('/api/notebooks/notebook/bots').flush({ bots });
    await fresh;
    oldRequest.flush({ bots: [{ ...bots[0], handle: 'stale' }] });
    await old;
    expect(await firstValueFrom(api.getNotebookBots('notebook'))).toEqual(bots);
  });
});

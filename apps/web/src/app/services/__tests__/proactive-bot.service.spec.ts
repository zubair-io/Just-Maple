import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ProactiveBotService } from '../proactive-bot.service';
import { PageService } from '../page.service';

describe('ProactiveBotService', () => {
  let service: ProactiveBotService;
  let http: HttpTestingController;
  const getPage = vi.fn(() => of({ id: 'page' }));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PageService, useValue: { getPage } },
      ],
    });
    service = TestBed.inject(ProactiveBotService);
    http = TestBed.inject(HttpTestingController);
    getPage.mockClear();
  });

  afterEach(() => http.verify());

  it('saves the setting and refreshes the page', async () => {
    const saving = service.save('page', {
      userBotId: 'bot',
      instructions: 'Be brief',
      enabled: true,
    });
    const request = http.expectOne('/api/pages/page/proactive');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      userBotId: 'bot',
      instructions: 'Be brief',
      enabled: true,
    });
    request.flush({ page: { id: 'page' } });
    await saving;
    expect(getPage).toHaveBeenCalledWith('page');
  });

  it('removes the setting', async () => {
    const removing = service.remove('page');
    const request = http.expectOne('/api/pages/page/proactive');
    expect(request.request.method).toBe('DELETE');
    request.flush({ page: { id: 'page' } });
    await removing;
    expect(getPage).toHaveBeenCalledWith('page');
  });

  it('reads the Mac status for a notebook', async () => {
    const status = service.status('n1');
    const request = http.expectOne((r) => r.url === '/api/mac-data/status');
    expect(request.request.params.get('notebookId')).toBe('n1');
    request.flush({ online: true, sources: ['mail'] });
    expect(await status).toEqual({ online: true, sources: ['mail'] });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { signal } from '@angular/core';
import type { ChatEvent } from '@maple/shared';
import { BotAutonomyComponent } from './bot-autonomy.component';
import { RealtimeService } from '../../../services/realtime.service';
import { AuthService } from '../../../services/auth.service';

describe('BotAutonomyComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BotAutonomyComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { events$: new Subject<ChatEvent>() } },
        { provide: AuthService, useValue: { user: signal({ _id: 'owner' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  async function render(settings: Record<string, string>) {
    const fixture = TestBed.createComponent(BotAutonomyComponent);
    fixture.componentRef.setInput('botId', 'bot-1');
    fixture.detectChanges();
    http.expectOne('/api/bot-autonomy/bot-1').flush({ settings });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const select = (kind: string) =>
      host.querySelector<HTMLSelectElement>(`[data-kind=${kind}] select`)!;
    const options = (kind: string) =>
      [...host.querySelectorAll(`[data-kind=${kind}] option`)].map((o) => o.textContent?.trim());
    return { fixture, host, select, options };
  }

  const defaults = { calendar_add: 'ask', home_service: 'ask', send_reply: 'ask' };

  it('offers "Do it and tell me" only where it is allowed', async () => {
    const { options, select, host } = await render({ ...defaults, home_service: 'never' });
    expect(options('calendar_add')).toEqual(['Ask every time', 'Do it and tell me', 'Never']);
    expect(options('home_service')).toEqual(['Ask every time', 'Do it and tell me', 'Never']);
    // Sending always asks first.
    expect(options('send_reply')).toEqual(['Ask every time', 'Never']);
    expect(select('home_service').value).toBe('never');
    expect(host.textContent).toContain('applies only in your own private notebooks');
  });

  it('saves a change', async () => {
    const { fixture, select } = await render(defaults);
    select('calendar_add').value = 'auto';
    select('calendar_add').dispatchEvent(new Event('change'));
    const save = http.expectOne({ method: 'PUT', url: '/api/bot-autonomy/bot-1' });
    expect(save.request.body).toEqual({ kind: 'calendar_add', autonomy: 'auto' });
    save.flush({ settings: { ...defaults, calendar_add: 'auto' } });
    await fixture.whenStable();
    expect(fixture.componentInstance.settings().calendar_add).toBe('auto');
  });

  it('puts the setting back and says so when saving fails', async () => {
    const { fixture, select, host } = await render(defaults);
    select('calendar_add').value = 'never';
    select('calendar_add').dispatchEvent(new Event('change'));
    http
      .expectOne({ method: 'PUT', url: '/api/bot-autonomy/bot-1' })
      .flush({ error: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(fixture.componentInstance.settings().calendar_add).toBe('ask');
    expect(host.textContent).toContain('Could not save that');
  });
});

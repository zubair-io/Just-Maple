import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { of } from 'rxjs';
import { BotsComponent } from './bots.component';
import { BotService, type EnrichedUserBot } from '../../services/bot.service';
import { DialogService } from '../../components';
import type { BotTemplate } from '@maple/shared';

const template = {
  _id: 'template',
  name: 'Claude',
  handle: 'claude',
  requiresConfig: true,
  definition: {
    actions: [{ type: 'llm', config: { provider: 'anthropic', model: 'claude-current' } }],
  },
} as unknown as BotTemplate;
const bot = {
  _id: 'bot',
  userId: 'owner',
  templateId: 'template',
  handle: 'claude',
  isEnabled: true,
  config: { model: 'claude-current', apiKey: '***REDACTED***' },
} as EnrichedUserBot;

describe('web search switch in bot settings', () => {
  const service = {
    templates: signal([template]),
    templatesLoading: signal(false),
    userBots: signal([bot]),
    userBotsLoading: signal(false),
    webSearchAvailable: signal(true),
    customBots: signal([]),
    customBotsLoading: signal(false),
    loadTemplates: vi.fn(() => of([])),
    loadUserBots: vi.fn(() => of([])),
    loadCustomBots: vi.fn(() => of([])),
    loadModels: vi.fn(() => of([{ id: 'claude-current', name: 'Claude Current' }])),
    updateBot: vi.fn(() => of(bot)),
    registerBot: vi.fn(() => of(bot)),
  };
  beforeEach(() => {
    service.updateBot.mockClear();
    service.webSearchAvailable.set(true);
    TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [
        { provide: BotService, useValue: service },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: Clipboard, useValue: { copy: vi.fn() } },
        { provide: DialogService, useValue: {} },
      ],
    });
  });

  const labels = (root: HTMLElement) =>
    [...root.querySelectorAll('.toggle-label span')].map((s) => s.textContent?.trim());
  const savedConfig = (call: number) =>
    (service.updateBot.mock.calls[call] as unknown as [string, { config: object }])[1].config;

  it('is off by default, and turning it on saves webSearch', async () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.editBot(bot);
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(labels(root)).toContain('Search the web');
    // The proactive switch only shows once web search is on.
    expect(labels(root)).not.toContain('Also when posting on its own');
    expect(component.editWebSearch()).toBe(false);

    component.saveBot();
    expect(savedConfig(0)).toMatchObject({ webSearch: false, webSearchProactive: false });

    component.editBot(bot);
    component.editWebSearch.set(true);
    fixture.detectChanges();
    expect(labels(root)).toContain('Also when posting on its own');
    component.editWebSearchProactive.set(true);
    component.saveBot();
    expect(savedConfig(1)).toMatchObject({ webSearch: true, webSearchProactive: true });
    fixture.destroy();
  });

  it('never saves proactive search without web search', () => {
    const fixture = TestBed.createComponent(BotsComponent);
    const component = fixture.componentInstance;
    component.editBot({ ...bot, config: { ...bot.config, webSearchProactive: true } });
    component.saveBot();
    expect(savedConfig(0)).toMatchObject({ webSearch: false, webSearchProactive: false });
    fixture.destroy();
  });

  it('is hidden, and left alone, when the server has no search key', async () => {
    service.webSearchAvailable.set(false);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.editBot({ ...bot, config: { ...bot.config, webSearch: true } });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(labels(fixture.nativeElement)).not.toContain('Search the web');
    component.saveBot();
    expect(savedConfig(0)).not.toHaveProperty('webSearch');
    fixture.destroy();
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { of, Subject, throwError } from 'rxjs';
import { BotsComponent } from './bots.component';
import { BotService, type EnrichedUserBot, type CustomBot } from '../../services/bot.service';
import { DialogService } from '../../components';
import type { BotTemplate, BotModelOption } from '@maple/shared';

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
  displayName: 'My assistant',
  config: { model: 'claude-current', apiKey: '***REDACTED***' },
} as EnrichedUserBot;

describe('provider models in bot settings', () => {
  const service = {
    templates: signal([template]),
    templatesLoading: signal(false),
    userBots: signal([bot]),
    userBotsLoading: signal(false),
    webSearchAvailable: signal(false),
    customBots: signal<CustomBot[]>([]),
    customBotsLoading: signal(false),
    loadTemplates: vi.fn(() => of([])),
    loadUserBots: vi.fn(() => of([])),
    loadCustomBots: vi.fn(() => of([])),
    loadModels: vi.fn(),
    updateBot: vi.fn(() => of(bot)),
    registerBot: vi.fn(() => of(bot)),
    updateCustomBot: vi.fn(() => of(bot)),
  };
  beforeEach(() => {
    service.loadModels.mockReset();
    service.userBots.set([bot]);
    service.customBots.set([]);
    service.updateBot.mockClear();
    service.updateCustomBot.mockClear();
    service.loadModels.mockReturnValue(
      of([
        { id: 'claude-current', name: 'Claude Current' },
        { id: 'claude-next', name: 'Claude Next' },
      ]),
    );
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
  it('shows a webhook bot once using its custom edit dialog, even when both lists contain it', () => {
    const webhook = {
      ...bot,
      _id: 'webhook',
      botType: 'custom' as const,
      invokeUrl: 'https://example.com/webhook',
      permissions: { messages: { read: true, write: true } },
      status: 'active',
    } as CustomBot;
    service.userBots.set([bot, webhook as EnrichedUserBot]);
    service.customBots.set([webhook]);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.allBots().filter((b) => b._id === 'webhook')).toEqual([
      expect.objectContaining({ botType: 'custom' }),
    ]);
    fixture.destroy();
  });
  it('edits the AI name and handle and displays the saved name on its card', async () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bot-name').textContent).toContain('My assistant');
    const component = fixture.componentInstance;
    component.editBot(bot);
    fixture.detectChanges();
    await fixture.whenStable();
    const handle: HTMLInputElement = fixture.nativeElement.querySelector('#editHandle');
    const name: HTMLInputElement = fixture.nativeElement.querySelector('#editDisplayName');
    expect(handle.disabled).toBe(false);
    expect(handle.value).toBe('claude');
    handle.value = 'My_Assistant';
    handle.dispatchEvent(new Event('input'));
    name.value = 'Personal helper';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    component.saveBot();
    expect(service.updateBot).toHaveBeenLastCalledWith(
      'bot',
      expect.objectContaining({ handle: 'my_assistant', displayName: 'Personal helper' }),
    );
    component.editBot(bot);
    component.editHandle.set('bad handle');
    component.saveBot();
    expect(service.updateBot).toHaveBeenCalledTimes(1);
    expect(component.editError()).toContain('1–30');
    fixture.destroy();
  });
  it('edits webhook handles and names instead of showing a disabled handle', async () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.editCustomBot({
      ...bot,
      botType: 'custom',
      invokeUrl: 'https://example.com/webhook',
      displayName: 'Webhook bot',
    } as CustomBot);
    fixture.detectChanges();
    await fixture.whenStable();
    const handle: HTMLInputElement = fixture.nativeElement.querySelector('#editCustomBotHandle');
    expect(handle.disabled).toBe(false);
    expect(handle.value).toBe('claude');
    component.editCustomBotHandle.set(' webhook_new ');
    component.editCustomBotName.set('New webhook');
    component.saveCustomBot();
    expect(service.updateCustomBot).toHaveBeenCalledWith(
      'bot',
      expect.objectContaining({ handle: 'webhook_new', name: 'New webhook' }),
    );
    fixture.destroy();
  });
  it('loads saved credentials by bot ID and persists the dropdown selection', async () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    fixture.componentInstance.editBot(bot);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(service.loadModels).toHaveBeenCalledWith({ userBotId: 'bot', apiKey: undefined });
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#editModel');
    expect([...select.options].map((o) => o.textContent)).toContain(' Claude Next (claude-next) ');
    select.value = 'claude-next';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.componentInstance.saveBot();
    expect(service.updateBot).toHaveBeenCalledWith(
      'bot',
      expect.objectContaining({ config: expect.objectContaining({ model: 'claude-next' }) }),
    );
    expect(service.updateBot.mock.calls[0]![1].config.apiKey).toBeUndefined();
    fixture.destroy();
  });
  it('uses a draft replacement key and displays recoverable provider errors', async () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    fixture.componentInstance.editBot(bot);
    fixture.componentInstance.changeApiKey('edit', 'replacement-key');
    service.loadModels.mockReturnValue(throwError(() => new Error('Provider unavailable')));
    fixture.componentInstance.loadEditModels();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(service.loadModels).toHaveBeenLastCalledWith({
      userBotId: 'bot',
      apiKey: 'replacement-key',
    });
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'Provider unavailable',
    );
    expect(fixture.componentInstance.editModel()).toBe('claude-current');
    fixture.destroy();
  });
  it('discards stale model results when credentials change or a modal closes', () => {
    const pending = new Subject<BotModelOption[]>();
    service.loadModels.mockReturnValue(pending);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    fixture.componentInstance.editBot(bot);
    fixture.componentInstance.changeApiKey('edit', 'new-key');
    pending.next([{ id: 'claude-stale', name: 'Stale' }]);
    expect(fixture.componentInstance.editModels()).toEqual([]);
    fixture.componentInstance.closeEditDialog();
    fixture.destroy();
  });
  it('loads new-bot options using its entered API key instead of a hardcoded catalog', () => {
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectTemplate(template);
    fixture.componentInstance.changeApiKey('register', 'draft-key');
    fixture.componentInstance.loadRegisterModels();
    expect(service.loadModels).toHaveBeenCalledWith({
      templateId: 'template',
      apiKey: 'draft-key',
    });
    expect(fixture.componentInstance.registerModels()).toHaveLength(2);
    fixture.destroy();
  });
  it('adds any number of AI providers, including custom servers from the New button', () => {
    const custom = {
      _id: 'custom',
      name: 'Custom AI provider',
      handle: 'openai-compatible',
      requiresConfig: true,
      definition: { actions: [{ type: 'llm', config: { provider: 'openai-compatible' } }] },
    } as unknown as BotTemplate;
    service.templates.set([template, custom]);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).toContain('AI Providers');
    // The custom template is behind "New", and Claude can be added again with a fresh handle.
    expect([...page.querySelectorAll('.template-name')].map((n) => n.textContent)).toEqual([
      'Claude',
    ]);
    expect(page.querySelector('.template-card.registered')).toBeNull();
    fixture.componentInstance.selectTemplate(template);
    expect(fixture.componentInstance.customHandle()).toBe('claude2');
    fixture.componentInstance.closeRegisterDialog();

    const newButton = [...page.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().endsWith('New'),
    )!;
    newButton.click();
    fixture.detectChanges();
    expect(page.querySelector('.dialog-header h2')!.textContent).toContain('New AI provider');
    const component = fixture.componentInstance;
    component.displayName.set('Groq');
    component.changeBaseUrl('register', 'https://api.groq.com/openai/v1');
    component.changeApiKey('register', 'groq-key');
    component.loadRegisterModels();
    expect(service.loadModels).toHaveBeenLastCalledWith({
      templateId: 'custom',
      apiKey: 'groq-key',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    component.model.set('llama-3.3-70b-versatile');
    component.registerBot();
    expect(service.registerBot).toHaveBeenCalledWith({
      templateId: 'custom',
      handle: 'ai',
      displayName: 'Groq',
      config: {
        apiKey: 'groq-key',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        responseMode: 'auto',
      },
    });
    service.templates.set([template]);
    fixture.destroy();
  });
  it('adds a custom provider without a key and loads its models from the button', () => {
    const custom = {
      _id: 'custom',
      name: 'Custom AI provider',
      handle: 'openai-compatible',
      requiresConfig: true,
      definition: { actions: [{ type: 'llm', config: { provider: 'openai-compatible' } }] },
    } as unknown as BotTemplate;
    service.templates.set([template, custom]);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectTemplate(custom);
    component.changeBaseUrl('register', 'https://llm.example.com/v1');
    fixture.detectChanges();
    const load = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'Load models',
    ) as HTMLButtonElement;
    expect(load.disabled).toBe(false);
    load.click();
    expect(service.loadModels).toHaveBeenLastCalledWith({
      templateId: 'custom',
      apiKey: undefined,
      baseUrl: 'https://llm.example.com/v1',
    });
    component.model.set('open-model');
    component.registerBot();
    expect(component.registerError()).toBeNull();
    expect(service.registerBot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ apiKey: '', baseUrl: 'https://llm.example.com/v1' }),
      }),
    );
    service.templates.set([template]);
    fixture.destroy();
  });
});

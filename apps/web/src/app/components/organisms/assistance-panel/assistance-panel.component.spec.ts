import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistancePanelComponent } from './assistance-panel.component';
import { AssistanceService } from '../../../services/assistance.service';
import { NotebookService } from '../../../services/notebook.service';
import { VoiceConversationService } from '../../../services/voice-conversation.service';

const conversation = (id = 'conversation') => ({
  id,
  pageId: 'page',
  notebookId: 'notebook',
  botId: 'bot',
  botName: 'Bot',
  createdAt: '2026-10-31T00:00:00Z',
  draftVersion: 0,
});
const history = (id = 'conversation') => ({
  conversation: conversation(id),
  messages: [],
  tasks: [],
  hasMore: false,
});
describe('persistent assistance composer', () => {
  let fixture: ComponentFixture<AssistancePanelComponent>, component: AssistancePanelComponent;
  const api = { bots: vi.fn(), open: vi.fn(), history: vi.fn(), send: vi.fn(), saveDraft: vi.fn() };
  beforeEach(async () => {
    localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    api.bots.mockResolvedValue([{ id: 'bot', name: 'Bot', handle: 'bot' }]);
    api.open.mockResolvedValue(conversation());
    api.history.mockImplementation(async (id: string) => history(id));
    api.saveDraft.mockResolvedValue({ ...conversation(), draftVersion: 1 });
    TestBed.configureTestingModule({
      imports: [AssistancePanelComponent],
      providers: [
        { provide: AssistanceService, useValue: api },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: NotebookService, useValue: { notebooks: signal([]) } },
      ],
    });
    TestBed.overrideComponent(AssistancePanelComponent, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: VoiceConversationService, useValue: { stop: vi.fn(), state: signal('idle') } },
        ],
      },
    });
    fixture = TestBed.createComponent(AssistancePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('notebookId', 'notebook');
    fixture.componentRef.setInput('pageId', 'page');
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });
  it('reuses the request id after an uncertain submission and keeps the text', async () => {
    component.onDraft('My question');
    api.send.mockRejectedValue(new Error('Connection lost'));
    await component.send();
    await component.send();
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[0]?.[1]).toBe(api.send.mock.calls[1]?.[1]);
    expect(component.draft()).toBe('My question');
  });
  it('ignores history arriving after navigating to another page', async () => {
    let finish!: (value: unknown) => void;
    api.history.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const oldRefresh = component.refresh();
    fixture.componentRef.setInput('pageId', 'other-page');
    api.open.mockResolvedValue(conversation('new-conversation'));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.conversation()?.id).toBe('new-conversation'));
    finish({ ...history(), messages: [{ id: 'old-private-message' }] });
    await oldRefresh;
    expect(component.conversation()?.id).toBe('new-conversation');
    expect(component.messages()).toEqual([]);
  });
  it('retains both drafts on conflict and requires a choice before overwriting', async () => {
    component.onDraft('My local version');
    api.saveDraft.mockRejectedValueOnce({ status: 409, error: { message: 'Draft changed' } });
    api.history.mockResolvedValue({
      ...history(),
      conversation: { ...conversation(), draft: 'Other device version', draftVersion: 4 },
    });
    await component.saveDraft();
    expect(component.draft()).toBe('My local version');
    expect(component.conflictingDraft()?.text).toBe('Other device version');
    await component.saveDraft();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    await component.resolveDraft(true);
    expect(api.saveDraft).toHaveBeenLastCalledWith('conversation', 'My local version', 4);
  });
  it('recovers the uncertain request receipt after reopening', async () => {
    component.onDraft('A retained question');
    api.send.mockRejectedValue(new Error('Connection lost'));
    await component.send();
    const receipt = api.send.mock.calls[0]?.[1];
    fixture.destroy();
    fixture = TestBed.createComponent(AssistancePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('notebookId', 'notebook');
    fixture.componentRef.setInput('pageId', 'page');
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.conversation()?.id).toBe('conversation'));
    expect(component.draft()).toBe('A retained question');
    await component.send();
    expect(api.send.mock.calls[1]?.[1]).toBe(receipt);
  });
});

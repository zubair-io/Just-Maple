import { TestBed } from '@angular/core/testing';
import type { Page } from '@maple/shared';
import { ProactiveBotPanelComponent } from '../proactive-bot-panel.component';
import { ProactiveBotService } from '../../../../services/proactive-bot.service';
import { NotebookService } from '../../../../services/notebook.service';

describe('ProactiveBotPanelComponent', () => {
  function setup(sharedWith: unknown[], proactive?: Page['proactive']) {
    const service = {
      status: vi.fn(async () => ({ online: true, sources: ['calendar'] })),
      save: vi.fn(async () => ({}) as Page),
    };
    TestBed.configureTestingModule({
      imports: [ProactiveBotPanelComponent],
      providers: [
        { provide: ProactiveBotService, useValue: service },
        {
          provide: NotebookService,
          useValue: { notebooks: () => [{ _id: 'n1', sharing: { sharedWith } }] },
        },
      ],
    });
    const fixture = TestBed.createComponent(ProactiveBotPanelComponent);
    fixture.componentRef.setInput('page', {
      id: 'chat',
      notebookId: 'n1',
      title: 'Family',
      ...(proactive ? { proactive } : {}),
    } as Page);
    fixture.componentRef.setInput('botId', 'bot1');
    fixture.detectChanges();
    return { fixture, service, root: fixture.nativeElement as HTMLElement };
  }

  it('warns when other people can see the notebook', () => {
    expect(setup([{ userId: 'u2' }]).root.textContent).toContain('Others can see this notebook');
    TestBed.resetTestingModule();
    expect(setup([]).root.textContent).not.toContain('Others can see this notebook');
  });

  it('saves a daily brief time, and turns it off', async () => {
    const { fixture, service } = setup([]);
    fixture.componentInstance.briefOn.set(true);
    fixture.componentInstance.briefTime.set('06:45');
    await fixture.componentInstance.save();
    expect(service.save).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({ briefTime: '06:45', enabled: true }),
    );
    fixture.componentInstance.briefOn.set(false);
    await fixture.componentInstance.save();
    expect(service.save).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({ briefTime: null }),
    );
  });

  it('starts from the saved brief time for this bot', () => {
    const { fixture } = setup([], {
      userBotId: 'bot1',
      instructions: 'Track school',
      enabled: true,
      ownerUserId: 'u1',
      briefTime: '07:15',
      updatedAt: '2026-10-26T00:00:00Z',
    });
    expect(fixture.componentInstance.briefOn()).toBe(true);
    expect(fixture.componentInstance.briefTime()).toBe('07:15');
    expect(fixture.componentInstance.instructions()).toBe('Track school');
  });
});

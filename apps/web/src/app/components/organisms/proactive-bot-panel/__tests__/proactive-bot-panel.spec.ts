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
    const owner = { userId: 'u1', accessLevel: 'owner' };
    expect(setup([owner, { userId: 'u2', accessLevel: 'read' }]).root.textContent).toContain(
      'Others can see this notebook',
    );
    TestBed.resetTestingModule();
    // Only the owner: private.
    expect(setup([owner]).root.textContent).not.toContain('Others can see this notebook');
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

  it('starts from the default timing: wait up to 2 hours, quiet 10pm to 7am', () => {
    const { fixture, root } = setup([]);
    const panel = fixture.componentInstance;
    expect(panel.everyItem()).toBe(false);
    expect(panel.maxWaitMinutes()).toBe(120);
    expect([panel.quietOn(), panel.quietStart(), panel.quietEnd()]).toEqual([
      true,
      '22:00',
      '07:00',
    ]);
    const select = root.querySelector<HTMLSelectElement>('#proactive-max-wait')!;
    expect(select.selectedOptions[0]!.textContent!.trim()).toBe('2 hours');
  });

  it('starts from the saved timing for this bot', () => {
    const { fixture } = setup([], {
      userBotId: 'bot1',
      instructions: '',
      enabled: true,
      ownerUserId: 'u1',
      maxWaitMinutes: 45,
      quietHours: { enabled: false, start: '23:00', end: '06:30' },
      everyItem: true,
      updatedAt: '2026-10-26T00:00:00Z',
    });
    const panel = fixture.componentInstance;
    expect(panel.maxWaitMinutes()).toBe(45);
    expect(panel.waitOptions().map((o) => o.label)).toContain('45 minutes');
    expect([panel.quietOn(), panel.quietStart(), panel.quietEnd()]).toEqual([
      false,
      '23:00',
      '06:30',
    ]);
    expect(panel.everyItem()).toBe(true);
  });

  it('saves max wait, quiet hours and "every item"', async () => {
    const { fixture, service, root } = setup([]);
    const select = root.querySelector<HTMLSelectElement>('#proactive-max-wait')!;
    select.value = '240';
    select.dispatchEvent(new Event('change'));
    const start = root.querySelector<HTMLInputElement>('[aria-label="Quiet hours start"]')!;
    start.value = '21:30';
    start.dispatchEvent(new Event('input'));
    await fixture.componentInstance.save();
    expect(service.save).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({
        everyItem: false,
        maxWaitMinutes: 240,
        quietHours: { enabled: true, start: '21:30', end: '07:00' },
      }),
    );

    // "Every item" hides the timing choices.
    const everything = [...root.querySelectorAll('label')].find((l) =>
      l.textContent!.includes('everything right away'),
    )!;
    const box = everything.querySelector('input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(root.querySelector('#proactive-max-wait')).toBeNull();
    await fixture.componentInstance.save();
    expect(service.save).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({ everyItem: true }),
    );
  });

  it('does not overwrite edits in progress when nothing it tracks changed', () => {
    const { fixture } = setup([]);
    fixture.componentInstance.maxWaitMinutes.set(480);
    fixture.componentInstance.quietOn.set(false);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(fixture.componentInstance.maxWaitMinutes()).toBe(480);
    expect(fixture.componentInstance.quietOn()).toBe(false);
  });
});
